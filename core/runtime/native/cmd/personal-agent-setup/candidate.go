package main

import (
	"bufio"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/chenchen428/personal-agent-node/native/internal/embedded"
)

const candidatePlanTTL = 10 * time.Minute

type candidateSecurity struct {
	SchemaVersion         int             `json:"schemaVersion"`
	Kind                  string          `json:"kind"`
	ReleaseTag            string          `json:"releaseTag"`
	ReleaseID             string          `json:"releaseId"`
	Revision              string          `json:"revision"`
	Platform              string          `json:"platform"`
	FormalRelease         bool            `json:"formalRelease"`
	CandidateAssetRuntime bool            `json:"candidateAssetRuntime"`
	NativePlatformSigning map[string]any  `json:"nativePlatformSigning"`
	Verification          map[string]bool `json:"verification"`
}

type candidateBinding struct {
	SchemaVersion    int    `json:"schemaVersion"`
	ID               string `json:"id"`
	Command          string `json:"command"`
	Risk             string `json:"risk"`
	InputSummary     string `json:"inputSummary"`
	Target           string `json:"target"`
	StateFingerprint string `json:"stateFingerprint"`
	IdempotencyKey   string `json:"idempotencyKey"`
}

type candidateOperation struct {
	candidateBinding
	Digest      string         `json:"digest"`
	Status      string         `json:"status"`
	CreatedAt   string         `json:"createdAt"`
	ExpiresAt   string         `json:"expiresAt"`
	ApprovedAt  string         `json:"approvedAt,omitempty"`
	StartedAt   string         `json:"startedAt,omitempty"`
	CompletedAt string         `json:"completedAt,omitempty"`
	Approval    map[string]any `json:"approval,omitempty"`
	Error       map[string]any `json:"error,omitempty"`
}

type candidateArtifact struct {
	Name     string `json:"name"`
	Size     int64  `json:"size"`
	SHA256   string `json:"sha256"`
	Revision string `json:"revision"`
}

type candidateJob struct {
	SchemaVersion     int               `json:"schemaVersion"`
	ID                string            `json:"id"`
	Kind              string            `json:"kind"`
	Source            string            `json:"source"`
	Status            string            `json:"status"`
	CreatedAt         string            `json:"createdAt"`
	UpdatedAt         string            `json:"updatedAt"`
	Platform          string            `json:"platform"`
	TargetVersion     string            `json:"targetVersion"`
	TargetReleaseID   string            `json:"targetReleaseId"`
	PreviousReleaseID string            `json:"previousReleaseId"`
	Artifact          candidateArtifact `json:"artifact"`
	ArtifactPath      string            `json:"artifactPath"`
	OperationID       string            `json:"operationId"`
	OperationDigest   string            `json:"operationDigest"`
	OperationPath     string            `json:"candidateOperationPath"`
	PlanExpiresAt     string            `json:"candidatePlanExpiresAt"`
	HandoffNonce      string            `json:"handoffNonce,omitempty"`
	Failure           map[string]any    `json:"failure,omitempty"`
}

type installationSnapshot struct {
	ActiveReleaseID string `json:"activeReleaseId"`
	Revision        string `json:"revision"`
}

func candidatePlanCommand(args []string) {
	home, _ := os.UserHomeDir()
	set := flag.NewFlagSet("candidate-plan", flag.ExitOnError)
	homeRoot := set.String("home", filepath.Join(home, ".personal-agent"), "Personal Agent home")
	expectedRevision := set.String("expected-revision", "", "exact candidate Git revision")
	authorizedProductDelivery := set.Bool("authorized-product-delivery", false, "use the owner's initiating product-development request as standing authorization for this exact candidate")
	_ = set.Parse(args)
	if !validRevision(*expectedRevision) {
		fail("candidate plan requires an exact 40-character --expected-revision")
	}
	resolvedHome := normalizeUpdateHome(*homeRoot)
	executable, err := os.Executable()
	if err != nil {
		fail(err.Error())
	}
	security, err := inspectCandidate(executable)
	if err != nil {
		fail(err.Error())
	}
	if subtle.ConstantTimeCompare([]byte(strings.ToLower(security.Revision)), []byte(strings.ToLower(*expectedRevision))) != 1 {
		fail("candidate revision does not match the requested commit")
	}
	current, err := readInstallationSnapshot(resolvedHome)
	if err != nil {
		fail(err.Error())
	}
	assetSHA, assetSize, err := sha256File(executable)
	if err != nil {
		fail(err.Error())
	}
	jobID := "update_" + randomID()
	operationID := "op_" + randomID()
	created := time.Now().UTC()
	expires := created.Add(candidatePlanTTL)
	updatesRoot := filepath.Join(resolvedHome, "workspace", "installation", "updates")
	jobDirectory := filepath.Join(updatesRoot, jobID)
	if err := os.MkdirAll(jobDirectory, 0o700); err != nil {
		fail(err.Error())
	}
	artifactName := "candidate"
	if runtime.GOOS == "windows" {
		artifactName += ".exe"
	}
	artifactPath := filepath.Join(jobDirectory, artifactName)
	if err := copyExclusive(executable, artifactPath); err != nil {
		_ = os.RemoveAll(jobDirectory)
		fail(err.Error())
	}
	binding := candidateBinding{
		SchemaVersion:    1,
		ID:               operationID,
		Command:          "update candidate apply",
		Risk:             "R3",
		InputSummary:     fmt.Sprintf("Install local candidate %s at commit %s; restart required; GitHub Release acceptance remains pending", security.ReleaseID, shortRevision(security.Revision)),
		Target:           fmt.Sprintf("candidate:%s:%s", security.ReleaseID, platformKey()),
		StateFingerprint: fmt.Sprintf("%s:%s:%s", current.ActiveReleaseID, current.Revision, assetSHA),
		IdempotencyKey:   fmt.Sprintf("candidate:%s:%s", security.ReleaseID, assetSHA),
	}
	operation := candidateOperation{candidateBinding: binding, Digest: candidateDigest(binding), Status: "planned", CreatedAt: created.Format(time.RFC3339Nano), ExpiresAt: expires.Format(time.RFC3339Nano)}
	operationPath, err := candidateOperationPath(resolvedHome, operation.ID)
	if err != nil {
		_ = os.RemoveAll(jobDirectory)
		fail(err.Error())
	}
	job := candidateJob{
		SchemaVersion: 1, ID: jobID, Kind: "apply", Source: "local-candidate", Status: "planned",
		CreatedAt: operation.CreatedAt, UpdatedAt: operation.CreatedAt, Platform: platformKey(),
		TargetVersion: security.ReleaseID, TargetReleaseID: security.ReleaseID, PreviousReleaseID: current.ActiveReleaseID,
		Artifact: candidateArtifact{Name: artifactName, Size: assetSize, SHA256: assetSHA, Revision: security.Revision}, ArtifactPath: artifactPath,
		OperationID: operation.ID, OperationDigest: operation.Digest, OperationPath: operationPath, PlanExpiresAt: operation.ExpiresAt,
	}
	if err := writeCandidateFiles(jobDirectory, &job, &operation); err != nil {
		_ = os.RemoveAll(jobDirectory)
		fail(err.Error())
	}
	auditCandidate(resolvedHome, "planned", &operation, map[string]any{"releaseId": security.ReleaseID, "candidateAssetRuntime": true})
	result := map[string]any{
		"ok": true, "job": publicCandidateJob(job), "operation": operation,
	}
	if *authorizedProductDelivery {
		now := time.Now().UTC().Format(time.RFC3339Nano)
		approveCandidateState(&job, &operation, now, "owner-delegated-agent", "registered-product-development")
		if err := writeCandidateFiles(jobDirectory, &job, &operation); err != nil {
			fail(err.Error())
		}
		auditCandidate(resolvedHome, "approved", &operation, map[string]any{"channel": "registered-product-development", "scope": "exact-candidate-digest"})
		result["job"], result["operation"] = publicCandidateJob(job), operation
		result["authorization"] = "owner-delegated-product-delivery"
	} else {
		result["confirmation"] = fmt.Sprintf("APPROVE %s %s", operation.ID, operation.Digest[:12])
		result["approveCommand"] = fmt.Sprintf("personal-agent operation approve %s --digest %s --json", operation.ID, operation.Digest)
	}
	write(result)
}

func candidateApproveCommand(args []string) {
	home, operationID, digestValue := candidateOperationFlags("candidate-approve", args)
	if !interactiveTerminal(os.Stdin, os.Stdout) {
		fail("candidate approval requires an interactive local TTY")
	}
	jobDirectory, job, operation := requireCandidatePlan(home, operationID, digestValue, "planned")
	prompt := fmt.Sprintf("APPROVE %s %s", operation.ID, operation.Digest[:12])
	fmt.Fprintf(os.Stderr, "Type %s to approve this 10-minute local candidate install plan: ", prompt)
	line, err := bufio.NewReader(io.LimitReader(os.Stdin, 1024)).ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		fail("candidate approval could not read local confirmation")
	}
	if subtle.ConstantTimeCompare([]byte(strings.TrimSpace(line)), []byte(prompt)) != 1 {
		fail("candidate approval confirmation did not match")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	approveCandidateState(&job, &operation, now, "human", "local-tty")
	if err := writeCandidateFiles(jobDirectory, &job, &operation); err != nil {
		fail(err.Error())
	}
	auditCandidate(home, "approved", &operation, map[string]any{"channel": "local-tty"})
	write(map[string]any{"ok": true, "job": publicCandidateJob(job), "operation": operation})
}

func approveCandidateState(job *candidateJob, operation *candidateOperation, now, kind, channel string) {
	operation.Status, operation.ApprovedAt = "approved", now
	operation.Approval = map[string]any{
		"kind": kind, "channel": channel, "authenticated": true,
		"scope": "exact-candidate-digest",
	}
	job.Status, job.UpdatedAt = "approved", now
}

func candidateApplyCommand(args []string) {
	home, operationID, digestValue := candidateOperationFlags("candidate-apply", args)
	jobDirectory, job, operation := requireCandidatePlan(home, operationID, digestValue, "approved")
	nonceBytes := make([]byte, 32)
	if _, err := rand.Read(nonceBytes); err != nil {
		fail(err.Error())
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	job.Status, job.UpdatedAt, job.HandoffNonce = "handoff", now, hex.EncodeToString(nonceBytes)
	operation.Status, operation.StartedAt = "executing", now
	if err := writeCandidateFiles(jobDirectory, &job, &operation); err != nil {
		fail(err.Error())
	}
	auditCandidate(home, "executing", &operation, map[string]any{"handoff": "desktop-owner"})
	launcher := filepath.Join(home, "core", "bin", "personal-agent-ui")
	if runtime.GOOS == "windows" {
		launcher += ".exe"
	}
	command := exec.Command(launcher, "--apply-update", job.ID, "--nonce", job.HandoffNonce)
	command.Env = append(os.Environ(), "PERSONAL_AGENT_HOME="+home)
	if err := command.Start(); err != nil {
		operation.Status, operation.CompletedAt = "failed", time.Now().UTC().Format(time.RFC3339Nano)
		operation.Error = map[string]any{"code": "CANDIDATE_HANDOFF_FAILED", "message": "desktop handoff could not be started"}
		job.Status, job.Failure = "failed", operation.Error
		_ = writeCandidateFiles(jobDirectory, &job, &operation)
		auditCandidate(home, "failed", &operation, map[string]any{"code": "CANDIDATE_HANDOFF_FAILED"})
		fail("candidate desktop handoff could not be started")
	}
	write(map[string]any{"ok": true, "job": publicCandidateJob(job), "operation": operation})
}

func candidateOperationFlags(name string, args []string) (string, string, string) {
	home, _ := os.UserHomeDir()
	set := flag.NewFlagSet(name, flag.ExitOnError)
	homeRoot := set.String("home", filepath.Join(home, ".personal-agent"), "Personal Agent home")
	operationID := set.String("operation", "", "candidate operation id")
	digestValue := set.String("digest", "", "candidate operation digest")
	_ = set.Parse(args)
	if !strings.HasPrefix(*operationID, "op_") || len(*digestValue) != 64 {
		fail(name + " requires --operation and the exact --digest")
	}
	return normalizeUpdateHome(*homeRoot), *operationID, strings.ToLower(*digestValue)
}

func requireCandidatePlan(home, operationID, digestValue, status string) (string, candidateJob, candidateOperation) {
	updatesRoot := filepath.Join(home, "workspace", "installation", "updates")
	entries, err := os.ReadDir(updatesRoot)
	if err != nil {
		fail("candidate plan does not exist")
	}
	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "update_") {
			continue
		}
		directory := filepath.Join(updatesRoot, entry.Name())
		var job candidateJob
		if readJSON(filepath.Join(directory, "job.json"), &job) != nil {
			fail("candidate job is invalid")
		}
		if job.OperationID != operationID {
			continue
		}
		expectedOperationPath, pathErr := candidateOperationPath(home, operationID)
		if pathErr != nil || filepath.Clean(job.OperationPath) != filepath.Clean(expectedOperationPath) {
			fail("candidate operation path is invalid")
		}
		var operation candidateOperation
		if readJSON(job.OperationPath, &operation) != nil || operation.ID != operationID {
			fail("candidate operation is invalid")
		}
		jobStatusMatches := job.Status == status || (status == "approved" && job.Status == "planned")
		if operation.Digest != digestValue || subtle.ConstantTimeCompare([]byte(candidateDigest(operation.candidateBinding)), []byte(digestValue)) != 1 || job.OperationID != operation.ID || job.OperationDigest != operation.Digest || !jobStatusMatches || operation.Status != status {
			fail("candidate operation digest or state does not match the plan")
		}
		if expires, parseErr := time.Parse(time.RFC3339Nano, operation.ExpiresAt); parseErr != nil || !time.Now().UTC().Before(expires) {
			operation.Status, job.Status = "expired", "failed"
			operation.CompletedAt = time.Now().UTC().Format(time.RFC3339Nano)
			_ = writeCandidateFiles(directory, &job, &operation)
			auditCandidate(home, "expired", &operation, nil)
			fail("candidate install plan has expired")
		}
		actualSHA, actualSize, hashErr := sha256File(job.ArtifactPath)
		if hashErr != nil || actualSize != job.Artifact.Size || subtle.ConstantTimeCompare([]byte(actualSHA), []byte(job.Artifact.SHA256)) != 1 || filepath.Dir(filepath.Clean(job.ArtifactPath)) != filepath.Clean(directory) {
			fail("candidate artifact no longer matches the approved plan")
		}
		current, snapshotErr := readInstallationSnapshot(home)
		if snapshotErr != nil || operation.StateFingerprint != fmt.Sprintf("%s:%s:%s", current.ActiveReleaseID, current.Revision, actualSHA) {
			fail("installed state changed after the candidate plan was created")
		}
		if status == "approved" && job.Status == "planned" {
			job.Status, job.UpdatedAt = "approved", time.Now().UTC().Format(time.RFC3339Nano)
			if err := writeJSONFile(filepath.Join(directory, "job.json"), &job); err != nil {
				fail(err.Error())
			}
		}
		return directory, job, operation
	}
	fail("candidate operation was not found")
	return "", candidateJob{}, candidateOperation{}
}

func inspectCandidate(executable string) (candidateSecurity, error) {
	temporary, err := os.MkdirTemp("", "personal-agent-candidate-inspect-")
	if err != nil {
		return candidateSecurity{}, err
	}
	defer os.RemoveAll(temporary)
	payload, err := embedded.Extract(executable, temporary)
	if err != nil {
		return candidateSecurity{}, err
	}
	manifest, err := verifyRelease(payload.ReleaseRoot)
	if err != nil {
		return candidateSecurity{}, err
	}
	var security candidateSecurity
	securityFile := filepath.Join(payload.ReleaseRoot, "CANDIDATE-SECURITY.json")
	if err := requireChecksummedFile(payload.ReleaseRoot, "CANDIDATE-SECURITY.json"); err != nil {
		return candidateSecurity{}, err
	}
	if err := readJSON(securityFile, &security); err != nil {
		return candidateSecurity{}, errors.New("candidate security metadata is missing")
	}
	expectedPlatform := platformKey()
	if security.SchemaVersion != 1 || security.Kind != "personal-agent-local-candidate" || security.FormalRelease || !security.CandidateAssetRuntime || security.ReleaseID != manifest.ReleaseID || security.Revision != manifest.Revision || security.ReleaseTag != "v"+manifest.ReleaseID || security.Platform != expectedPlatform {
		return candidateSecurity{}, errors.New("candidate security metadata does not match the embedded release")
	}
	for _, key := range []string{"manifest", "sha256", "sbom", "platform"} {
		if !security.Verification[key] {
			return candidateSecurity{}, errors.New("candidate security metadata is incomplete")
		}
	}
	status, _ := security.NativePlatformSigning["status"].(string)
	if !strings.Contains(manifest.ReleaseID, "-") && status != "verified" {
		return candidateSecurity{}, errors.New("stable candidate requires verified native platform signing")
	}
	return security, nil
}

func requireChecksummedFile(releaseRoot, relative string) error {
	data, err := os.ReadFile(filepath.Join(releaseRoot, "SHA256SUMS"))
	if err != nil {
		return errors.New("candidate checksums are missing")
	}
	actual, _, err := sha256File(filepath.Join(releaseRoot, filepath.FromSlash(relative)))
	if err != nil {
		return err
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 2 && strings.TrimPrefix(fields[1], "*") == relative && subtle.ConstantTimeCompare([]byte(strings.ToLower(fields[0])), []byte(actual)) == 1 {
			return nil
		}
	}
	return errors.New("candidate security metadata is not covered by SHA256SUMS")
}

func verifyCandidateHandoff(home, jobPath string, job *updateJob) error {
	if job.Source != "local-candidate" {
		return nil
	}
	directory := filepath.Dir(jobPath)
	if filepath.Clean(directory) != filepath.Clean(filepath.Join(updateJobAllowedRoot(home), job.ID)) {
		return errors.New("candidate handoff job is outside the approved directory")
	}
	operationPath, err := candidateOperationPath(home, job.OperationID)
	if err != nil || filepath.Clean(job.OperationPath) != filepath.Clean(operationPath) {
		return errors.New("candidate handoff operation path is invalid")
	}
	var operation candidateOperation
	if readJSON(operationPath, &operation) != nil || operation.ID != job.OperationID || operation.Status != "executing" || operation.Digest != job.OperationDigest || subtle.ConstantTimeCompare([]byte(candidateDigest(operation.candidateBinding)), []byte(job.OperationDigest)) != 1 {
		return errors.New("candidate handoff operation is not the approved execution")
	}
	expires, err := time.Parse(time.RFC3339Nano, operation.ExpiresAt)
	if err != nil || !time.Now().UTC().Before(expires) {
		return errors.New("candidate handoff operation has expired")
	}
	actualSHA, actualSize, err := sha256File(job.ArtifactPath)
	if err != nil || actualSize != job.Artifact.Size || subtle.ConstantTimeCompare([]byte(actualSHA), []byte(job.Artifact.SHA256)) != 1 {
		return errors.New("candidate handoff artifact no longer matches the approved digest")
	}
	current, err := readInstallationSnapshot(home)
	if err != nil || operation.StateFingerprint != fmt.Sprintf("%s:%s:%s", current.ActiveReleaseID, current.Revision, actualSHA) {
		return errors.New("installed state changed before candidate activation")
	}
	return nil
}

func completeCandidateOperation(jobPath string, job *updateJob, status string, cause error) {
	if job.Source != "local-candidate" || job.OperationID == "" {
		return
	}
	directory := filepath.Dir(jobPath)
	home := filepath.Dir(filepath.Dir(filepath.Dir(filepath.Dir(directory))))
	operationPath, pathErr := candidateOperationPath(home, job.OperationID)
	var operation candidateOperation
	if pathErr != nil || readJSON(operationPath, &operation) != nil || operation.ID != job.OperationID || subtle.ConstantTimeCompare([]byte(operation.Digest), []byte(job.OperationDigest)) != 1 {
		return
	}
	operation.Status, operation.CompletedAt = status, time.Now().UTC().Format(time.RFC3339Nano)
	if cause != nil {
		operation.Error = map[string]any{"code": "CANDIDATE_INSTALL_FAILED", "message": truncate(cause.Error(), 300)}
	}
	_ = writeJSONFile(operationPath, &operation)
	auditCandidate(home, status, &operation, map[string]any{"releaseId": job.TargetReleaseID})
}

func readInstallationSnapshot(home string) (installationSnapshot, error) {
	var snapshot installationSnapshot
	if err := readJSON(filepath.Join(home, "core", "installation.json"), &snapshot); err != nil || snapshot.ActiveReleaseID == "" {
		return snapshot, errors.New("installed Personal Agent state is unavailable")
	}
	return snapshot, nil
}

func candidateOperationPath(home, operationID string) (string, error) {
	spacesRoot := filepath.Join(home, "workspace", "spaces")
	entries, err := os.ReadDir(spacesRoot)
	if err != nil {
		return "", errors.New("Personal Agent Space registry is unavailable")
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		var space struct {
			SpaceID string `json:"spaceId"`
			Kind    string `json:"kind"`
		}
		spaceRoot := filepath.Join(spacesRoot, entry.Name())
		if readJSON(filepath.Join(spaceRoot, "space.json"), &space) == nil && space.Kind == "personal" && space.SpaceID == entry.Name() {
			directory := filepath.Join(spaceRoot, "runtime", "operations")
			if err := os.MkdirAll(directory, 0o700); err != nil {
				return "", err
			}
			return filepath.Join(directory, operationID+".json"), nil
		}
	}
	return "", errors.New("Personal Agent personal Space is unavailable")
}

func writeCandidateFiles(directory string, job *candidateJob, operation *candidateOperation) error {
	if err := writeJSONFile(job.OperationPath, operation); err != nil {
		return err
	}
	return writeJSONFile(filepath.Join(directory, "job.json"), job)
}

func writeJSONFile(file string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	temporary := fmt.Sprintf("%s.%d.tmp", file, os.Getpid())
	if err := os.WriteFile(temporary, append(data, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, file); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

func readJSON(file string, value any) error {
	data, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, value)
}

func candidateDigest(binding candidateBinding) string {
	values := map[string]any{
		"schemaVersion": binding.SchemaVersion, "id": binding.ID, "command": binding.Command,
		"risk": binding.Risk, "inputSummary": binding.InputSummary, "target": binding.Target,
		"stateFingerprint": binding.StateFingerprint, "idempotencyKey": binding.IdempotencyKey,
	}
	data := canonicalCandidateJSON(values)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func canonicalCandidateJSON(value any) []byte {
	switch typed := value.(type) {
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, key := range keys {
			keyJSON, _ := json.Marshal(key)
			parts = append(parts, string(keyJSON)+":"+string(canonicalCandidateJSON(typed[key])))
		}
		return []byte("{" + strings.Join(parts, ",") + "}")
	default:
		data, _ := json.Marshal(value)
		return data
	}
}

func sha256File(file string) (string, int64, error) {
	handle, err := os.Open(file)
	if err != nil {
		return "", 0, err
	}
	defer handle.Close()
	info, err := handle.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return "", 0, errors.New("candidate artifact is not a regular file")
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, handle); err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(hash.Sum(nil)), info.Size(), nil
}

func copyExclusive(source, target string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o700)
	if err != nil {
		return err
	}
	if _, err = io.Copy(output, input); err == nil {
		err = output.Sync()
	}
	closeErr := output.Close()
	if err != nil {
		_ = os.Remove(target)
		return err
	}
	return closeErr
}

func randomID() string {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		fail(err.Error())
	}
	return hex.EncodeToString(value)
}

func platformKey() string {
	arch := runtime.GOARCH
	if arch == "amd64" {
		arch = "x64"
	}
	osName := runtime.GOOS
	if osName == "windows" {
		osName = "win32"
	} else if osName == "darwin" {
		osName = "darwin"
	}
	return osName + "-" + arch
}

func validRevision(value string) bool {
	if len(value) != 40 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func shortRevision(value string) string {
	if len(value) > 12 {
		return value[:12]
	}
	return value
}

func publicCandidateJob(job candidateJob) map[string]any {
	return map[string]any{
		"schemaVersion": job.SchemaVersion, "id": job.ID, "kind": job.Kind, "source": job.Source,
		"status": job.Status, "createdAt": job.CreatedAt, "updatedAt": job.UpdatedAt, "platform": job.Platform,
		"targetVersion": job.TargetVersion, "targetReleaseId": job.TargetReleaseID, "previousReleaseId": job.PreviousReleaseID,
		"artifact": job.Artifact, "operationId": job.OperationID, "operationDigest": job.OperationDigest,
		"candidatePlanExpiresAt": job.PlanExpiresAt, "candidateAssetRuntime": true,
	}
}

func interactiveTerminal(input, output *os.File) bool {
	in, inErr := input.Stat()
	out, outErr := output.Stat()
	return inErr == nil && outErr == nil && in.Mode()&os.ModeCharDevice != 0 && out.Mode()&os.ModeCharDevice != 0
}

func auditCandidate(home, event string, operation *candidateOperation, detail map[string]any) {
	directory := filepath.Join(home, "workspace", "installation", "logs", "audit")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return
	}
	record := map[string]any{
		"schemaVersion": 1, "at": time.Now().UTC().Format(time.RFC3339Nano), "event": event,
		"operationId": operation.ID, "command": operation.Command, "risk": operation.Risk,
		"target": operation.Target, "status": operation.Status, "detail": detail,
	}
	data, err := json.Marshal(record)
	if err != nil {
		return
	}
	handle, err := os.OpenFile(filepath.Join(directory, "candidate-updates.ndjson"), os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o600)
	if err != nil {
		return
	}
	defer handle.Close()
	_, _ = handle.Write(append(data, '\n'))
}
