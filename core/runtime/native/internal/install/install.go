package install

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

type Manifest struct {
	SchemaVersion int    `json:"schemaVersion"`
	ReleaseType   string `json:"releaseType"`
	ReleaseID     string `json:"releaseId"`
	Revision      string `json:"revision"`
	Dirty         bool   `json:"dirty"`
}

type Options struct {
	ReleaseRoot   string
	NodeRuntime   string
	InstallRoot   string
	DataRoot      string
	Domain        string
	SkipService   bool
	SkipStartWait bool
	NoOpen        bool
	Platform      string
}

type Result struct {
	ReleaseID   string `json:"releaseId"`
	Revision    string `json:"revision"`
	InstallRoot string `json:"installRoot"`
	DataRoot    string `json:"dataRoot"`
	Current     string `json:"current"`
	Previous    string `json:"previous,omitempty"`
	SetupURL    string `json:"setupUrl"`
	Service     string `json:"service"`
}

type UninstallResult struct {
	InstallRoot   string `json:"installRoot"`
	DataRoot      string `json:"dataRoot"`
	DataPreserved bool   `json:"dataPreserved"`
	Service       string `json:"service"`
}

type Runner interface {
	Run(ctx context.Context, command string, args []string, env []string) ([]byte, error)
}

type OSRunner struct{}

func (OSRunner) Run(ctx context.Context, command string, args []string, env []string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Env = env
	cmd.Stderr = os.Stderr
	return cmd.Output()
}

func Install(ctx context.Context, opts Options, runner Runner) (result Result, returnedErr error) {
	if runner == nil {
		runner = OSRunner{}
	}
	resolved, err := normalizeOptions(opts)
	if err != nil {
		return result, err
	}
	manifest, err := VerifyRelease(resolved.ReleaseRoot)
	if err != nil {
		return result, err
	}
	if err := verifyNodeRuntime(resolved.NodeRuntime); err != nil {
		return result, err
	}

	releasesRoot := filepath.Join(resolved.InstallRoot, "releases")
	target := filepath.Join(releasesRoot, manifest.ReleaseID)
	temporary := target + fmt.Sprintf(".%d.tmp", os.Getpid())
	current := filepath.Join(resolved.InstallRoot, "current")
	previous := filepath.Join(resolved.InstallRoot, "previous")
	oldCurrent := pointerTarget(current)
	oldPrevious := pointerTarget(previous)
	activated := false
	serviceAttempted := false

	defer func() {
		if returnedErr == nil {
			return
		}
		_ = os.RemoveAll(temporary)
		if activated {
			if oldCurrent != "" {
				_ = replacePointer(current, oldCurrent, resolved.Platform, runner)
			} else {
				_ = removePointer(current)
			}
			if oldPrevious != "" {
				_ = replacePointer(previous, oldPrevious, resolved.Platform, runner)
			} else {
				_ = removePointer(previous)
			}
		}
		if serviceAttempted {
			recoveryCtx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			if oldCurrent != "" {
				oldNode := bundledNode(oldCurrent, resolved.Platform)
				oldPrivateSite := privateSiteEntrypoint(oldCurrent)
				_, _ = activateService(recoveryCtx, resolved, oldCurrent, oldNode, oldPrivateSite, runner, envFor(resolved))
			} else {
				_ = deactivateService(recoveryCtx, resolved, runner, envFor(resolved))
			}
		}
	}()

	if err := os.MkdirAll(releasesRoot, 0o700); err != nil {
		return result, err
	}
	if _, err := os.Stat(target); errors.Is(err, os.ErrNotExist) {
		_ = os.RemoveAll(temporary)
		if err := copyTree(resolved.ReleaseRoot, temporary); err != nil {
			return result, fmt.Errorf("stage release: %w", err)
		}
		runtimeDir := filepath.Join(temporary, "runtime")
		if err := os.MkdirAll(runtimeDir, 0o700); err != nil {
			return result, err
		}
		nodeName := "node"
		if resolved.Platform == "windows" {
			nodeName = "node.exe"
		}
		if err := copyFile(resolved.NodeRuntime, filepath.Join(runtimeDir, nodeName), 0o700); err != nil {
			return result, fmt.Errorf("stage Node runtime: %w", err)
		}
		if err := os.Rename(temporary, target); err != nil {
			return result, fmt.Errorf("activate staged directory: %w", err)
		}
	}

	if oldCurrent != "" && filepath.Clean(oldCurrent) != filepath.Clean(target) {
		if err := replacePointer(previous, oldCurrent, resolved.Platform, runner); err != nil {
			return result, fmt.Errorf("retain previous: %w", err)
		}
	}
	if err := replacePointer(current, target, resolved.Platform, runner); err != nil {
		return result, fmt.Errorf("switch current: %w", err)
	}
	activated = true
	launcherName := "personal-agent"
	if resolved.Platform == "windows" {
		launcherName += ".exe"
	}
	launcherSource := filepath.Join(target, launcherName)
	if _, statErr := os.Stat(launcherSource); statErr == nil {
		if err := copyFile(launcherSource, filepath.Join(resolved.InstallRoot, "bin", launcherName), 0o700); err != nil {
			return result, fmt.Errorf("install stable launcher: %w", err)
		}
	}

	node := bundledNode(target, resolved.Platform)
	privateSite := filepath.Join(target, "core", "runtime", "bin", "private-site.mjs")
	env := envFor(resolved)
	for _, args := range [][]string{
		{privateSite, "init", "--domain", resolved.Domain, "--data-root", resolved.DataRoot},
		{privateSite, "prepare", "--data-root", resolved.DataRoot},
	} {
		commandCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
		_, runErr := runner.Run(commandCtx, node, args, env)
		cancel()
		if runErr != nil {
			return result, fmt.Errorf("Node initialization failed: %w", runErr)
		}
	}

	service := "skipped"
	if !resolved.SkipService {
		serviceAttempted = true
		serviceCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		service, err = activateService(serviceCtx, resolved, target, node, privateSite, runner, env)
		cancel()
		if err != nil {
			return result, err
		}
		if !resolved.SkipStartWait {
			if err := waitForPort(ctx, "127.0.0.1", 8843, 90*time.Second); err != nil {
				return result, err
			}
		}
	}

	setupURL := "http://127.0.0.1:8843/app/setup"
	if !resolved.NoOpen {
		bootstrapURL, nonceErr := createBootstrapURL(resolved.DataRoot, setupURL)
		if nonceErr != nil {
			return result, nonceErr
		}
		_ = openBrowser(ctx, bootstrapURL, resolved.Platform, runner)
	}
	state := map[string]any{
		"schemaVersion":   2,
		"activeReleaseId": manifest.ReleaseID,
		"revision":        manifest.Revision,
		"dataRoot":        resolved.DataRoot,
		"service":         service,
		"activatedAt":     time.Now().UTC().Format(time.RFC3339),
		"current":         current,
		"previous":        pointerTarget(previous),
		"setup":           map[string]any{"path": "/app/setup", "wechatRequired": false},
	}
	if err := writeJSON(filepath.Join(resolved.InstallRoot, "installation.json"), state, 0o600); err != nil {
		return result, err
	}

	return Result{
		ReleaseID: manifest.ReleaseID, Revision: manifest.Revision,
		InstallRoot: resolved.InstallRoot, DataRoot: resolved.DataRoot,
		Current: current, Previous: pointerTarget(previous), SetupURL: setupURL, Service: service,
	}, nil
}

func createBootstrapURL(dataRoot, cleanURL string) (string, error) {
	nonce := make([]byte, 32)
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(nonce)
	digest := sha256.Sum256([]byte(token))
	document := map[string]any{
		"schemaVersion": 1,
		"sha256":        hex.EncodeToString(digest[:]),
		"expiresAt":     time.Now().UTC().Add(5 * time.Minute).Format(time.RFC3339),
	}
	file := filepath.Join(dataRoot, "runtime", "setup", "bootstrap.json")
	if err := writeJSON(file, document, 0o600); err != nil {
		return "", err
	}
	return cleanURL + "/bootstrap?token=" + token, nil
}

func Rollback(ctx context.Context, installRoot, platform string, runner Runner) (Result, error) {
	if runner == nil {
		runner = OSRunner{}
	}
	root, err := filepath.Abs(installRoot)
	if err != nil {
		return Result{}, err
	}
	current := filepath.Join(root, "current")
	previous := filepath.Join(root, "previous")
	currentTarget, previousTarget := pointerTarget(current), pointerTarget(previous)
	if previousTarget == "" {
		return Result{}, errors.New("no previous release is available")
	}
	manifest, err := readManifest(filepath.Join(previousTarget, "release-manifest.json"))
	if err != nil {
		return Result{}, err
	}
	if err := replacePointer(current, previousTarget, platform, runner); err != nil {
		return Result{}, err
	}
	if currentTarget != "" {
		if err := replacePointer(previous, currentTarget, platform, runner); err != nil {
			_ = replacePointer(current, currentTarget, platform, runner)
			return Result{}, err
		}
	}
	state := readInstallationState(filepath.Join(root, "installation.json"))
	if state.Service != "" && state.Service != "skipped" && state.DataRoot != "" {
		opts := Options{InstallRoot: root, DataRoot: state.DataRoot, Platform: platform}
		node := bundledNode(previousTarget, platform)
		privateSite := filepath.Join(previousTarget, "core", "runtime", "bin", "private-site.mjs")
		if _, serviceErr := activateService(ctx, opts, previousTarget, node, privateSite, runner, envFor(opts)); serviceErr != nil {
			_ = replacePointer(current, currentTarget, platform, runner)
			_ = replacePointer(previous, previousTarget, platform, runner)
			return Result{}, fmt.Errorf("restore previous service: %w", serviceErr)
		}
	}
	state.ActiveReleaseID = manifest.ReleaseID
	state.Revision = manifest.Revision
	state.ActivatedAt = time.Now().UTC().Format(time.RFC3339)
	state.Current = current
	state.Previous = pointerTarget(previous)
	if state.SchemaVersion != 0 {
		_ = writeJSON(filepath.Join(root, "installation.json"), state, 0o600)
	}
	return Result{ReleaseID: manifest.ReleaseID, Revision: manifest.Revision, InstallRoot: root, Current: current, Previous: pointerTarget(previous)}, nil
}

func Uninstall(ctx context.Context, installRoot, platform string, runner Runner) (UninstallResult, error) {
	if runner == nil {
		runner = OSRunner{}
	}
	root, err := filepath.Abs(installRoot)
	if err != nil {
		return UninstallResult{}, err
	}
	if err := validateUninstallRoot(root); err != nil {
		return UninstallResult{}, err
	}
	state := readInstallationState(filepath.Join(root, "installation.json"))
	if state.SchemaVersion < 1 || state.DataRoot == "" || state.ActiveReleaseID == "" {
		return UninstallResult{}, errors.New("installation.json does not describe a valid Personal Agent installation")
	}
	dataRoot, err := filepath.Abs(state.DataRoot)
	if err != nil {
		return UninstallResult{}, err
	}
	if pathWithin(dataRoot, root) {
		return UninstallResult{}, errors.New("refusing to uninstall because the data root is inside the installation root")
	}
	service := "not-registered"
	if state.Service != "" && state.Service != "skipped" {
		opts := Options{InstallRoot: root, DataRoot: dataRoot, Platform: platform}
		if err := deactivateService(ctx, opts, runner, envFor(opts)); err != nil {
			return UninstallResult{}, fmt.Errorf("deactivate platform service: %w", err)
		}
		service = "removed"
	}
	if err := os.RemoveAll(root); err != nil {
		return UninstallResult{}, fmt.Errorf("remove installed binaries: %w", err)
	}
	return UninstallResult{InstallRoot: root, DataRoot: dataRoot, DataPreserved: true, Service: service}, nil
}

func validateUninstallRoot(root string) error {
	clean := filepath.Clean(root)
	volume := filepath.VolumeName(clean)
	if clean == string(filepath.Separator) || clean == volume+string(filepath.Separator) {
		return errors.New("refusing to uninstall a filesystem root")
	}
	home, _ := os.UserHomeDir()
	if home != "" {
		absoluteHome, _ := filepath.Abs(home)
		if clean == filepath.Clean(absoluteHome) {
			return errors.New("refusing to uninstall the user home directory")
		}
	}
	return nil
}

func pathWithin(candidate, parent string) bool {
	relative, err := filepath.Rel(filepath.Clean(parent), filepath.Clean(candidate))
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

type installationState struct {
	SchemaVersion   int    `json:"schemaVersion"`
	ActiveReleaseID string `json:"activeReleaseId"`
	Revision        string `json:"revision"`
	ActivatedAt     string `json:"activatedAt"`
	Current         string `json:"current"`
	Previous        string `json:"previous,omitempty"`
	DataRoot        string `json:"dataRoot"`
	Service         string `json:"service"`
	Setup           any    `json:"setup,omitempty"`
}

func readInstallationState(file string) installationState {
	var state installationState
	data, err := os.ReadFile(file)
	if err == nil {
		_ = json.Unmarshal(data, &state)
	}
	return state
}

func VerifyRelease(root string) (Manifest, error) {
	manifest, err := readManifest(filepath.Join(root, "release-manifest.json"))
	if err != nil {
		return Manifest{}, err
	}
	if manifest.SchemaVersion != 2 || manifest.ReleaseType != "personal-agent-node" || manifest.ReleaseID == "" || manifest.Dirty {
		return Manifest{}, errors.New("release manifest is not an immutable Personal Agent Node release")
	}
	checksums, err := readChecksums(filepath.Join(root, "SHA256SUMS"))
	if err != nil {
		return Manifest{}, err
	}
	for relative, expected := range checksums {
		if !safeRelative(relative) {
			return Manifest{}, fmt.Errorf("unsafe checksum path: %s", relative)
		}
		actual, err := sha256File(filepath.Join(root, filepath.FromSlash(relative)))
		if err != nil {
			return Manifest{}, fmt.Errorf("checksum %s: %w", relative, err)
		}
		if actual != expected {
			return Manifest{}, fmt.Errorf("checksum mismatch: %s", relative)
		}
	}
	for _, required := range []string{"release-manifest.json", "core/runtime/bin/personal-agent.mjs", "core/runtime/bin/private-site.mjs", "SBOM.cdx.json"} {
		if _, ok := checksums[required]; !ok {
			return Manifest{}, fmt.Errorf("checksums omit required file: %s", required)
		}
	}
	return manifest, nil
}

func normalizeOptions(opts Options) (Options, error) {
	var err error
	for label, value := range map[string]string{"release root": opts.ReleaseRoot, "Node runtime": opts.NodeRuntime, "install root": opts.InstallRoot, "data root": opts.DataRoot} {
		if strings.TrimSpace(value) == "" {
			return opts, fmt.Errorf("%s is required", label)
		}
	}
	if opts.ReleaseRoot, err = filepath.Abs(opts.ReleaseRoot); err != nil {
		return opts, err
	}
	if opts.NodeRuntime, err = filepath.Abs(opts.NodeRuntime); err != nil {
		return opts, err
	}
	if opts.InstallRoot, err = filepath.Abs(opts.InstallRoot); err != nil {
		return opts, err
	}
	if opts.DataRoot, err = filepath.Abs(opts.DataRoot); err != nil {
		return opts, err
	}
	if opts.Domain == "" {
		opts.Domain = "personal-agent.local"
	}
	if opts.Platform == "" {
		opts.Platform = runtime.GOOS
	}
	return opts, nil
}

func activateService(ctx context.Context, opts Options, releaseRoot, node, privateSite string, runner Runner, env []string) (string, error) {
	_ = releaseRoot
	out, err := runner.Run(ctx, node, []string{privateSite, "service-prepare", "--data-root", opts.DataRoot}, env)
	if err != nil {
		return "", fmt.Errorf("prepare platform service: %w", err)
	}
	var service struct{ Platform, ServiceID, FilePath, InstallPath, TaskName, TaskXMLPath string }
	if err := json.Unmarshal(lastJSONObject(out), &service); err != nil {
		return "", fmt.Errorf("decode platform service: %w", err)
	}
	switch opts.Platform {
	case "darwin":
		if err := copyFile(service.FilePath, service.InstallPath, 0o600); err != nil {
			return "", err
		}
		_, _ = runner.Run(ctx, "launchctl", []string{"bootout", fmt.Sprintf("gui/%d/%s", os.Getuid(), service.ServiceID)}, env)
		if _, err := runner.Run(ctx, "launchctl", []string{"bootstrap", fmt.Sprintf("gui/%d", os.Getuid()), service.InstallPath}, env); err != nil {
			return "", err
		}
	case "linux":
		if err := copyFile(service.FilePath, service.InstallPath, 0o600); err != nil {
			return "", err
		}
		if _, err := runner.Run(ctx, "systemctl", []string{"--user", "daemon-reload"}, env); err != nil {
			return "", err
		}
		if _, err := runner.Run(ctx, "systemctl", []string{"--user", "enable", "--now", service.ServiceID}, env); err != nil {
			return "", err
		}
	case "windows":
		if _, err := runner.Run(ctx, "schtasks.exe", []string{"/Create", "/TN", service.TaskName, "/XML", service.TaskXMLPath, "/F"}, env); err != nil {
			return "", err
		}
		if _, err := runner.Run(ctx, "schtasks.exe", []string{"/Run", "/TN", service.TaskName}, env); err != nil {
			return "", err
		}
	default:
		return "", fmt.Errorf("unsupported service platform: %s", opts.Platform)
	}
	return service.ServiceID, nil
}

func deactivateService(ctx context.Context, opts Options, runner Runner, env []string) error {
	switch opts.Platform {
	case "darwin":
		serviceID := "site.personal-agent.private-site-node"
		_, _ = runner.Run(ctx, "launchctl", []string{"bootout", fmt.Sprintf("gui/%d/%s", os.Getuid(), serviceID)}, env)
		err := os.Remove(filepath.Join(userHome(), "Library", "LaunchAgents", serviceID+".plist"))
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	case "linux":
		serviceID := "private-site-node.service"
		_, _ = runner.Run(ctx, "systemctl", []string{"--user", "disable", "--now", serviceID}, env)
		_ = os.Remove(filepath.Join(userHome(), ".config", "systemd", "user", serviceID))
		_, _ = runner.Run(ctx, "systemctl", []string{"--user", "daemon-reload"}, env)
		return nil
	case "windows":
		_, _ = runner.Run(ctx, "schtasks.exe", []string{"/End", "/TN", "PrivateSiteNode"}, env)
		_, err := runner.Run(ctx, "schtasks.exe", []string{"/Delete", "/TN", "PrivateSiteNode", "/F"}, env)
		return err
	default:
		return fmt.Errorf("unsupported service platform: %s", opts.Platform)
	}
}

func replacePointer(linkPath, target, platform string, runner Runner) error {
	_ = runner
	if err := removePointer(linkPath); err != nil {
		return err
	}
	if platform == "windows" {
		if info, err := os.Stat(target); err != nil || !info.IsDir() {
			return fmt.Errorf("pointer target is not a directory: %s", target)
		}
		temporary := fmt.Sprintf("%s.%d.tmp", linkPath, os.Getpid())
		if err := os.WriteFile(temporary, []byte(filepath.Clean(target)+"\n"), 0o600); err != nil {
			return err
		}
		return os.Rename(temporary, linkPath)
	}
	return os.Symlink(filepath.Base(filepath.Dir(target))+string(filepath.Separator)+filepath.Base(target), linkPath)
}

func pointerTarget(link string) string {
	info, err := os.Lstat(link)
	if err != nil {
		return ""
	}
	var target string
	if info.Mode().IsRegular() {
		data, readErr := os.ReadFile(link)
		if readErr != nil || len(data) > 4096 {
			return ""
		}
		target = strings.TrimSpace(string(data))
	} else {
		target, err = filepath.EvalSymlinks(link)
		if err != nil {
			return ""
		}
	}
	absolute, err := filepath.Abs(target)
	if err != nil {
		return ""
	}
	if targetInfo, statErr := os.Stat(absolute); statErr != nil || !targetInfo.IsDir() {
		return ""
	}
	return absolute
}

func removePointer(pointer string) error {
	err := os.Remove(pointer)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func envFor(opts Options) []string {
	homeRoot := filepath.Dir(opts.InstallRoot)
	return append(os.Environ(), "PERSONAL_AGENT_HOME="+homeRoot, "PRIVATE_SITE_INSTALL_ROOT="+opts.InstallRoot, "PRIVATE_SITE_DATA_ROOT="+opts.DataRoot, "PRIVATE_SITE_CLI_BIN="+filepath.Join(opts.InstallRoot, "bin"))
}

func privateSiteEntrypoint(releaseRoot string) string {
	current := filepath.Join(releaseRoot, "core", "runtime", "bin", "private-site.mjs")
	if _, err := os.Stat(current); err == nil {
		return current
	}
	return filepath.Join(releaseRoot, "projects", "core", "node", "bin", "private-site.mjs")
}

func userHome() string {
	home, _ := os.UserHomeDir()
	return home
}

func verifyNodeRuntime(file string) error {
	info, err := os.Stat(file)
	if err != nil {
		return fmt.Errorf("Node runtime: %w", err)
	}
	if !info.Mode().IsRegular() {
		return errors.New("Node runtime is not a regular file")
	}
	return nil
}

func bundledNode(releaseRoot, platform string) string {
	name := "node"
	if platform == "windows" {
		name = "node.exe"
	}
	return filepath.Join(releaseRoot, "runtime", name)
}

func waitForPort(ctx context.Context, host string, port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		connection, err := (&net.Dialer{Timeout: 500 * time.Millisecond}).DialContext(ctx, "tcp", fmt.Sprintf("%s:%d", host, port))
		if err == nil {
			_ = connection.Close()
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
	return fmt.Errorf("Personal Agent gateway did not become ready within %s", timeout)
}

func openBrowser(ctx context.Context, url, platform string, runner Runner) error {
	switch platform {
	case "darwin":
		_, err := runner.Run(ctx, "open", []string{url}, os.Environ())
		return err
	case "windows":
		_, err := runner.Run(ctx, "rundll32.exe", []string{"url.dll,FileProtocolHandler", url}, os.Environ())
		return err
	default:
		_, err := runner.Run(ctx, "xdg-open", []string{url}, os.Environ())
		return err
	}
}

func copyTree(source, target string) error {
	return filepath.WalkDir(source, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, current)
		if err != nil {
			return err
		}
		destination := filepath.Join(target, relative)
		info, err := entry.Info()
		if err != nil {
			return err
		}
		switch {
		case entry.IsDir():
			return os.MkdirAll(destination, info.Mode().Perm())
		case info.Mode().IsRegular():
			return copyFile(current, destination, info.Mode().Perm())
		case info.Mode()&os.ModeSymlink != 0:
			linkTarget, err := os.Readlink(current)
			if err != nil {
				return err
			}
			resolved := filepath.Clean(filepath.Join(filepath.Dir(current), linkTarget))
			root := filepath.Clean(source)
			if filepath.IsAbs(linkTarget) || (resolved != root && !strings.HasPrefix(resolved, root+string(filepath.Separator))) {
				return fmt.Errorf("unsafe release symlink: %s", relative)
			}
			return os.Symlink(linkTarget, destination)
		default:
			return fmt.Errorf("unsupported release member: %s", relative)
		}
	})
}

func copyFile(source, target string, mode fs.FileMode) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return err
	}
	output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func readManifest(file string) (Manifest, error) {
	var value Manifest
	data, err := os.ReadFile(file)
	if err != nil {
		return value, err
	}
	if err := json.Unmarshal(data, &value); err != nil {
		return value, err
	}
	return value, nil
}

func readChecksums(file string) (map[string]string, error) {
	input, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	defer input.Close()
	result := map[string]string{}
	scanner := bufio.NewScanner(input)
	for scanner.Scan() {
		parts := strings.SplitN(scanner.Text(), "  ", 2)
		if len(parts) != 2 || len(parts[0]) != 64 {
			return nil, errors.New("invalid SHA256SUMS")
		}
		if _, err := hex.DecodeString(parts[0]); err != nil {
			return nil, errors.New("invalid SHA256SUMS digest")
		}
		result[parts[1]] = parts[0]
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if len(result) == 0 {
		return nil, errors.New("SHA256SUMS is empty")
	}
	return result, nil
}

func sha256File(file string) (string, error) {
	input, err := os.Open(file)
	if err != nil {
		return "", err
	}
	defer input.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, input); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func safeRelative(value string) bool {
	clean := filepath.Clean(filepath.FromSlash(value))
	return value != "" && !filepath.IsAbs(clean) && clean != ".." && !strings.HasPrefix(clean, ".."+string(filepath.Separator))
}

func writeJSON(file string, value any, mode fs.FileMode) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		return err
	}
	temporary := fmt.Sprintf("%s.%d.tmp", file, os.Getpid())
	if err := os.WriteFile(temporary, append(data, '\n'), mode); err != nil {
		return err
	}
	return os.Rename(temporary, file)
}

func lastJSONObject(output []byte) []byte {
	trimmed := strings.TrimSpace(string(output))
	indices := make([]int, 0)
	for index, value := range trimmed {
		if value == '{' {
			indices = append(indices, index)
		}
	}
	sort.Sort(sort.Reverse(sort.IntSlice(indices)))
	for _, index := range indices {
		candidate := []byte(trimmed[index:])
		var value any
		if json.Unmarshal(candidate, &value) == nil {
			return candidate
		}
	}
	return output
}
