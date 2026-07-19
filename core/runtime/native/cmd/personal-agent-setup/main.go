package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/chenchen428/personal-agent-node/native/internal/embedded"
	installer "github.com/chenchen428/personal-agent-node/native/internal/install"
)

var buildVersion = "development"

func main() {
	if len(os.Args) < 2 {
		installCommand(nil, true)
		return
	}
	switch os.Args[1] {
	case "install":
		installCommand(os.Args[2:], false)
	case "rollback":
		rollbackCommand(os.Args[2:])
	case "update":
		updateCommand(os.Args[2:])
	case "rollback-update":
		rollbackUpdateCommand(os.Args[2:])
	case "uninstall":
		uninstallCommand(os.Args[2:])
	case "verify":
		verifyCommand(os.Args[2:])
	case "inspect":
		inspectEmbedded()
	default:
		fail("unknown setup command: " + os.Args[1])
	}
}

type updateJob struct {
	SchemaVersion   int            `json:"schemaVersion"`
	ID              string         `json:"id"`
	Kind            string         `json:"kind"`
	Status          string         `json:"status"`
	TargetReleaseID string         `json:"targetReleaseId"`
	ArtifactPath    string         `json:"artifactPath,omitempty"`
	HandoffNonce    string         `json:"handoffNonce"`
	UpdatedAt       string         `json:"updatedAt"`
	CompletedAt     string         `json:"completedAt,omitempty"`
	Failure         map[string]any `json:"failure,omitempty"`
	Warning         map[string]any `json:"warning,omitempty"`
}

func updateCommand(args []string) {
	home, jobPath, nonce := updateFlags("update", args)
	job := requireUpdateJob(home, jobPath, nonce, "apply")
	executable, err := os.Executable()
	if err != nil {
		failUpdate(jobPath, &job, err)
	}
	if !sameFile(executable, job.ArtifactPath) {
		failUpdate(jobPath, &job, fmt.Errorf("candidate executable does not match the approved artifact"))
	}
	temporary := filepath.Join(os.TempDir(), fmt.Sprintf("personal-agent-update-%d", time.Now().UnixNano()))
	defer os.RemoveAll(temporary)
	payload, err := embedded.Extract(executable, temporary)
	if err != nil {
		failUpdate(jobPath, &job, err)
	}
	manifest, err := verifyRelease(payload.ReleaseRoot)
	if err != nil {
		failUpdate(jobPath, &job, err)
	}
	if manifest.ReleaseID != job.TargetReleaseID {
		failUpdate(jobPath, &job, fmt.Errorf("candidate release does not match the approved target"))
	}
	if !strings.Contains(manifest.ReleaseID, "-") {
		if err := verifyStableUpdateSignature(executable); err != nil {
			failUpdate(jobPath, &job, err)
		}
	}
	job.Status = "activating"
	writeUpdateJob(jobPath, &job)
	result, err := installer.Install(context.Background(), installer.Options{ReleaseRoot: payload.ReleaseRoot, NodeRuntime: payload.NodeRuntime, InstallRoot: filepath.Join(home, "core"), DataRoot: filepath.Join(home, "workspace"), Platform: runtime.GOOS, AllowDirty: isLocalAcceptanceBuild()}, nil)
	if err != nil {
		job.Status = "rolled_back"
		job.Failure = map[string]any{"code": "UPDATE_INSTALL_FAILED", "message": truncate(err.Error(), 300)}
		job.CompletedAt = time.Now().UTC().Format(time.RFC3339)
		writeUpdateJob(jobPath, &job)
		_ = launchInstalledDesktop(home, "/app/update")
		fail(err.Error())
	}
	if err := installSetupExecutable(executable, result.InstallRoot); err != nil {
		job.Warning = map[string]any{"code": "STABLE_EXECUTOR_REFRESH_FAILED", "message": truncate(err.Error(), 300)}
	}
	job.Status = "succeeded"
	job.CompletedAt = time.Now().UTC().Format(time.RFC3339)
	job.Failure = nil
	writeUpdateJob(jobPath, &job)
}

func rollbackUpdateCommand(args []string) {
	home, jobPath, nonce := updateFlags("rollback-update", args)
	job := requireUpdateJob(home, jobPath, nonce, "rollback")
	job.Status = "activating"
	writeUpdateJob(jobPath, &job)
	result, err := installer.Rollback(context.Background(), filepath.Join(home, "core"), runtime.GOOS, nil)
	if err != nil {
		failUpdate(jobPath, &job, err)
	}
	if result.ReleaseID != job.TargetReleaseID {
		failUpdate(jobPath, &job, fmt.Errorf("rollback target does not match the approved release"))
	}
	if err := launchInstalledDesktop(home, "/app/update"); err != nil {
		failUpdate(jobPath, &job, err)
	}
	if err := waitForLocalGateway(90 * time.Second); err != nil {
		failUpdate(jobPath, &job, err)
	}
	job.Status = "rolled_back"
	job.CompletedAt = time.Now().UTC().Format(time.RFC3339)
	writeUpdateJob(jobPath, &job)
}

func updateFlags(name string, args []string) (string, string, string) {
	home, _ := os.UserHomeDir()
	set := flag.NewFlagSet(name, flag.ExitOnError)
	homeRoot := set.String("home", filepath.Join(home, ".personal-agent"), "Personal Agent home")
	job := set.String("job", "", "approved update job")
	nonce := set.String("nonce", "", "desktop handoff nonce")
	_ = set.Parse(args)
	if *job == "" || *nonce == "" {
		fail("update handoff requires --job and --nonce")
	}
	return filepath.Clean(*homeRoot), filepath.Clean(*job), *nonce
}

func requireUpdateJob(home, jobPath, nonce, kind string) updateJob {
	allowedRoot := filepath.Join(home, "workspace", "runtime", "updates")
	relative, err := filepath.Rel(allowedRoot, jobPath)
	if err != nil || relative == "." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || filepath.Base(jobPath) != "job.json" {
		fail("update job is outside the Personal Agent workspace")
	}
	data, err := os.ReadFile(jobPath)
	if err != nil {
		fail(err.Error())
	}
	var job updateJob
	if json.Unmarshal(data, &job) != nil || job.SchemaVersion != 1 || job.Kind != kind || job.Status != "activating" || !strings.HasPrefix(job.ID, "update_") {
		fail("update job is invalid")
	}
	if subtle.ConstantTimeCompare([]byte(job.HandoffNonce), []byte(nonce)) != 1 {
		fail("update handoff nonce is invalid")
	}
	return job
}

func writeUpdateJob(jobPath string, job *updateJob) {
	job.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	data, err := json.MarshalIndent(job, "", "  ")
	if err != nil {
		fail(err.Error())
	}
	temporary := fmt.Sprintf("%s.%d.tmp", jobPath, os.Getpid())
	if err := os.WriteFile(temporary, append(data, '\n'), 0o600); err != nil {
		fail(err.Error())
	}
	if err := os.Rename(temporary, jobPath); err != nil {
		_ = os.Remove(temporary)
		fail(err.Error())
	}
}

func failUpdate(jobPath string, job *updateJob, err error) {
	job.Status = "failed"
	job.Failure = map[string]any{"code": "UPDATE_EXECUTOR_FAILED", "message": truncate(err.Error(), 300)}
	job.CompletedAt = time.Now().UTC().Format(time.RFC3339)
	writeUpdateJob(jobPath, job)
	fail(err.Error())
}

func sameFile(left, right string) bool {
	a, errA := filepath.EvalSymlinks(left)
	b, errB := filepath.EvalSymlinks(right)
	return errA == nil && errB == nil && filepath.Clean(a) == filepath.Clean(b)
}

func verifyStableUpdateSignature(executable string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("codesign", "--verify", "--strict", "--verbose=2", executable).Run()
	case "windows":
		script := `$signature=Get-AuthenticodeSignature -LiteralPath $args[0];if($signature.Status -ne 'Valid'){exit 1}`
		return exec.Command("powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script, executable).Run()
	default:
		return nil
	}
}

func launchInstalledDesktop(home, route string) error {
	launcher := filepath.Join(home, "core", "bin", "personal-agent-ui")
	if runtime.GOOS == "windows" {
		launcher += ".exe"
	}
	command := exec.Command(launcher, "--url", "http://127.0.0.1:8843"+route)
	command.Env = append(os.Environ(), "PERSONAL_AGENT_HOME="+home, "PRIVATE_SITE_INSTALL_ROOT="+filepath.Join(home, "core"), "PRIVATE_SITE_DATA_ROOT="+filepath.Join(home, "workspace"))
	return command.Start()
}

func waitForLocalGateway(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		connection, err := net.DialTimeout("tcp", "127.0.0.1:8843", 500*time.Millisecond)
		if err == nil {
			_ = connection.Close()
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	return fmt.Errorf("updated Personal Agent did not become ready")
}

func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}

func inspectEmbedded() {
	executable, err := os.Executable()
	if err != nil {
		fail(err.Error())
	}
	temporary := filepath.Join(os.TempDir(), fmt.Sprintf("personal-agent-inspect-%d", time.Now().UnixNano()))
	defer os.RemoveAll(temporary)
	payload, err := embedded.Extract(executable, temporary)
	if err != nil {
		fail(err.Error())
	}
	manifest, err := verifyRelease(payload.ReleaseRoot)
	if err != nil {
		fail(err.Error())
	}
	write(map[string]any{"ok": true, "buildVersion": buildVersion, "releaseId": manifest.ReleaseID, "revision": manifest.Revision, "embeddedNode": filepath.Base(payload.NodeRuntime)})
}

func installSetupExecutable(source, installRoot string) error {
	name := "personal-agent-setup"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	target := filepath.Join(installRoot, "bin", name)
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return err
	}
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	return os.WriteFile(target, data, 0o700)
}

type installHomeChooser func(string) (string, bool, error)

func resolveInstallHome(defaultHome string, interactive bool, platform string, chooser installHomeChooser) (string, bool, error) {
	resolvedDefault, err := filepath.Abs(defaultHome)
	if err != nil {
		return "", false, err
	}
	resolvedDefault = filepath.Clean(resolvedDefault)
	if !interactive || platform != "windows" {
		return resolvedDefault, true, nil
	}
	selected, accepted, err := chooser(resolvedDefault)
	if err != nil || !accepted {
		return "", accepted, err
	}
	selected = strings.TrimSpace(selected)
	if selected == "" {
		return "", false, fmt.Errorf("installation location is empty")
	}
	resolved, err := filepath.Abs(selected)
	if err != nil {
		return "", false, err
	}
	return filepath.Clean(resolved), true, nil
}

func installCommand(args []string, interactive bool) {
	home, _ := os.UserHomeDir()
	set := flag.NewFlagSet("install", flag.ExitOnError)
	releaseRoot := set.String("release-root", "", "verified immutable Node release directory")
	nodeRuntime := set.String("node-runtime", "", "exact bundled Node runtime")
	homeRoot := set.String("home", filepath.Join(home, ".personal-agent"), "Personal Agent home containing core and workspace")
	installRoot := set.String("install-root", "", "legacy override for the immutable core root")
	dataRoot := set.String("data-root", "", "legacy override for the mutable workspace root")
	domain := set.String("domain", "", "initial local domain (preserves an existing Workspace domain when omitted)")
	noOpen := set.Bool("no-open", false, "do not open the Setup Center")
	skipService := set.Bool("skip-service", false, "test-only: do not register the platform service")
	skipWait := set.Bool("skip-start-wait", false, "test-only: do not wait for gateway readiness")
	skipDesktopEntry := set.Bool("skip-desktop-entry", false, "test-only: do not install the platform desktop entry")
	_ = set.Parse(args)
	selectedHome, accepted, selectionErr := resolveInstallHome(*homeRoot, interactive, runtime.GOOS, selectInstallHome)
	if selectionErr != nil {
		fail(selectionErr.Error())
	}
	if !accepted {
		return
	}
	*homeRoot = selectedHome
	if *installRoot == "" {
		*installRoot = filepath.Join(*homeRoot, "core")
	}
	if *dataRoot == "" {
		*dataRoot = filepath.Join(*homeRoot, "workspace")
	}
	executable, executableErr := os.Executable()
	if executableErr != nil {
		fail(executableErr.Error())
	}
	resolvedReleaseRoot, resolvedNodeRuntime := *releaseRoot, *nodeRuntime
	temporary := ""
	if resolvedReleaseRoot == "" && resolvedNodeRuntime == "" {
		temporaryBase := os.TempDir()
		if runtime.GOOS == "windows" {
			if err := os.MkdirAll(*homeRoot, 0o700); err != nil {
				fail(err.Error())
			}
			temporaryBase = *homeRoot
		}
		var temporaryErr error
		temporary, temporaryErr = os.MkdirTemp(temporaryBase, ".personal-agent-setup-")
		if temporaryErr != nil {
			fail(temporaryErr.Error())
		}
		defer os.RemoveAll(temporary)
		payload, extractErr := embedded.Extract(executable, temporary)
		if extractErr != nil {
			fail(extractErr.Error())
		}
		resolvedReleaseRoot, resolvedNodeRuntime = payload.ReleaseRoot, payload.NodeRuntime
	} else if resolvedReleaseRoot == "" || resolvedNodeRuntime == "" {
		fail("--release-root and --node-runtime must be provided together")
	}
	result, err := installer.Install(context.Background(), installer.Options{ReleaseRoot: resolvedReleaseRoot, NodeRuntime: resolvedNodeRuntime, InstallRoot: *installRoot, DataRoot: *dataRoot, Domain: *domain, NoOpen: *noOpen, SkipService: *skipService, SkipStartWait: *skipWait, SkipDesktopEntry: *skipDesktopEntry, Platform: runtime.GOOS, AllowDirty: isLocalAcceptanceBuild()}, nil)
	if err != nil {
		fail(err.Error())
	}
	if err := installSetupExecutable(executable, result.InstallRoot); err != nil {
		fail(err.Error())
	}
	write(result)
}

func rollbackCommand(args []string) {
	home, _ := os.UserHomeDir()
	set := flag.NewFlagSet("rollback", flag.ExitOnError)
	homeRoot := set.String("home", filepath.Join(home, ".personal-agent"), "Personal Agent home")
	installRoot := set.String("install-root", "", "legacy override for the immutable core root")
	_ = set.Parse(args)
	if *installRoot == "" {
		*installRoot = filepath.Join(*homeRoot, "core")
	}
	result, err := installer.Rollback(context.Background(), *installRoot, runtime.GOOS, nil)
	if err != nil {
		fail(err.Error())
	}
	write(result)
}

func uninstallCommand(args []string) {
	home, _ := os.UserHomeDir()
	set := flag.NewFlagSet("uninstall", flag.ExitOnError)
	homeRoot := set.String("home", filepath.Join(home, ".personal-agent"), "Personal Agent home")
	installRoot := set.String("install-root", "", "legacy override for the immutable core root")
	confirmed := set.Bool("confirm-remove-binaries", false, "confirm removal of installed program files; user data is preserved")
	_ = set.Parse(args)
	if *installRoot == "" {
		*installRoot = filepath.Join(*homeRoot, "core")
	}
	if !*confirmed {
		fail("uninstall requires --confirm-remove-binaries; user data is preserved by default")
	}
	result, err := installer.Uninstall(context.Background(), *installRoot, runtime.GOOS, nil)
	if err != nil {
		fail(err.Error())
	}
	write(result)
}

func verifyCommand(args []string) {
	set := flag.NewFlagSet("verify", flag.ExitOnError)
	releaseRoot := set.String("release-root", "", "release directory")
	_ = set.Parse(args)
	manifest, err := verifyRelease(*releaseRoot)
	if err != nil {
		fail(err.Error())
	}
	write(map[string]any{"ok": true, "releaseId": manifest.ReleaseID, "revision": manifest.Revision})
}

func write(value any)              { data, _ := json.Marshal(value); fmt.Println(string(data)) }
func isLocalAcceptanceBuild() bool { return strings.Contains(buildVersion, "-local-acceptance.") }
func verifyRelease(root string) (installer.Manifest, error) {
	if isLocalAcceptanceBuild() {
		return installer.VerifyLocalAcceptanceRelease(root)
	}
	return installer.VerifyRelease(root)
}
func fail(message string) {
	data, _ := json.Marshal(map[string]any{"ok": false, "error": map[string]string{"code": "SETUP_FAILED", "message": message}})
	fmt.Fprintln(os.Stderr, string(data))
	os.Exit(1)
}
