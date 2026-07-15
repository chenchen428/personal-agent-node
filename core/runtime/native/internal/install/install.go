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
	SchemaVersion int                   `json:"schemaVersion"`
	ReleaseType   string                `json:"releaseType"`
	ReleaseID     string                `json:"releaseId"`
	Revision      string                `json:"revision"`
	Dirty         bool                  `json:"dirty"`
	DesktopShell  *DesktopShellManifest `json:"desktopShell,omitempty"`
}

type DesktopShellManifest struct {
	Framework      string `json:"framework"`
	Platform       string `json:"platform"`
	Entrypoint     string `json:"entrypoint"`
	StableLauncher string `json:"stableLauncher"`
	Icon           string `json:"icon"`
}

type Options struct {
	ReleaseRoot      string
	NodeRuntime      string
	InstallRoot      string
	DataRoot         string
	Domain           string
	SkipService      bool
	SkipStartWait    bool
	SkipDesktopEntry bool
	DesktopEntryRoot string
	NoOpen           bool
	Platform         string
}

type pathSnapshot struct {
	path    string
	exists  bool
	mode    fs.FileMode
	data    []byte
	symlink string
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
	oldState := readInstallationState(filepath.Join(resolved.InstallRoot, "installation.json"))
	hadManagedService := oldCurrent != "" && serviceIsManaged(oldState.Service)
	activated := false
	serviceNeedsRecovery := false
	targetNeedsReplace := !installedReleaseMatches(target, manifest, resolved.NodeRuntime, resolved.Platform)
	targetBackup := ""
	targetReplaced := false

	defer func() {
		if returnedErr == nil {
			if targetBackup != "" {
				_ = os.RemoveAll(targetBackup)
			}
			return
		}
		_ = os.RemoveAll(temporary)
		if targetReplaced {
			_ = os.RemoveAll(target)
			if targetBackup != "" {
				_ = os.Rename(targetBackup, target)
			}
		}
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
		if serviceNeedsRecovery {
			recoveryCtx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			_ = deactivateService(recoveryCtx, resolved, runner, envFor(resolved))
			if hadManagedService {
				oldNode := bundledNode(oldCurrent, resolved.Platform)
				oldPrivateSite := privateSiteEntrypoint(oldCurrent)
				_, _ = activateService(recoveryCtx, resolved, oldCurrent, oldNode, oldPrivateSite, runner, envFor(resolved))
			}
		}
	}()

	if err := os.MkdirAll(releasesRoot, 0o700); err != nil {
		return result, err
	}
	if targetNeedsReplace {
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
	}
	if !resolved.SkipService {
		serviceCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		if hadManagedService {
			err = deactivateService(serviceCtx, resolved, runner, envFor(resolved))
			serviceNeedsRecovery = true
		}
		if err == nil {
			supervisorRelease := oldCurrent
			if supervisorRelease == "" || (targetNeedsReplace && filepath.Clean(supervisorRelease) == filepath.Clean(target)) {
				if targetNeedsReplace {
					supervisorRelease = temporary
				} else {
					supervisorRelease = target
				}
			}
			if supervisorRelease == "" {
				supervisorRelease = target
			}
			err = stopSupervisor(serviceCtx, resolved, supervisorRelease, runner, envFor(resolved))
		}
		cancel()
		if err != nil {
			return result, fmt.Errorf("stop existing Personal Agent service: %w", err)
		}
	}
	if targetNeedsReplace {
		if _, statErr := os.Stat(target); statErr == nil {
			targetBackup = target + fmt.Sprintf(".%d.replaced", os.Getpid())
			_ = os.RemoveAll(targetBackup)
			if err := os.Rename(target, targetBackup); err != nil {
				return result, fmt.Errorf("retain replaced release: %w", err)
			}
		} else if !errors.Is(statErr, os.ErrNotExist) {
			return result, fmt.Errorf("inspect installed release: %w", statErr)
		}
		if err := os.Rename(temporary, target); err != nil {
			if targetBackup != "" {
				_ = os.Rename(targetBackup, target)
				targetBackup = ""
			}
			return result, fmt.Errorf("activate staged directory: %w", err)
		}
		targetReplaced = true
	}

	activated = true
	if oldCurrent != "" && filepath.Clean(oldCurrent) != filepath.Clean(target) {
		if err := replacePointer(previous, oldCurrent, resolved.Platform, runner); err != nil {
			return result, fmt.Errorf("retain previous: %w", err)
		}
	}
	if err := replacePointer(current, target, resolved.Platform, runner); err != nil {
		return result, fmt.Errorf("switch current: %w", err)
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
		serviceNeedsRecovery = true
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
	bootstrapURL := ""
	if !resolved.NoOpen {
		var nonceErr error
		bootstrapURL, nonceErr = createBootstrapURL(resolved.DataRoot, setupURL)
		if nonceErr != nil {
			return result, nonceErr
		}
	}
	if err := commitDesktopIntegration(resolved, target, manifest, state, runner, env); err != nil {
		return result, fmt.Errorf("commit desktop integration: %w", err)
	}
	if !resolved.NoOpen {
		if manifest.DesktopShell != nil {
			_ = openDesktopShell(ctx, bootstrapURL, resolved, runner, envFor(resolved))
		} else {
			_ = openBrowser(ctx, bootstrapURL, resolved.Platform, runner)
		}
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
	state := readInstallationState(filepath.Join(root, "installation.json"))
	managedService := serviceIsManaged(state.Service) && state.DataRoot != ""
	opts := Options{InstallRoot: root, DataRoot: state.DataRoot, Platform: platform}
	restoreCurrentService := func() {
		if !managedService || currentTarget == "" {
			return
		}
		_ = deactivateService(ctx, opts, runner, envFor(opts))
		node := bundledNode(currentTarget, platform)
		privateSite := privateSiteEntrypoint(currentTarget)
		_, _ = activateService(ctx, opts, currentTarget, node, privateSite, runner, envFor(opts))
	}
	if managedService {
		if err := deactivateService(ctx, opts, runner, envFor(opts)); err != nil {
			return Result{}, fmt.Errorf("stop active platform service: %w", err)
		}
	}
	if err := replacePointer(current, previousTarget, platform, runner); err != nil {
		restoreCurrentService()
		return Result{}, err
	}
	if currentTarget != "" {
		if err := replacePointer(previous, currentTarget, platform, runner); err != nil {
			_ = replacePointer(current, currentTarget, platform, runner)
			restoreCurrentService()
			return Result{}, err
		}
	}
	if managedService {
		node := bundledNode(previousTarget, platform)
		privateSite := privateSiteEntrypoint(previousTarget)
		if _, serviceErr := activateService(ctx, opts, previousTarget, node, privateSite, runner, envFor(opts)); serviceErr != nil {
			_ = replacePointer(current, currentTarget, platform, runner)
			_ = replacePointer(previous, previousTarget, platform, runner)
			restoreCurrentService()
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
	if err := removeDesktopEntry(root, platform); err != nil {
		return UninstallResult{}, fmt.Errorf("remove desktop entry: %w", err)
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

func serviceIsManaged(service string) bool {
	return service != "" && service != "skipped" && service != "not-registered" && service != "removed"
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
	if manifest.DesktopShell != nil {
		if manifest.DesktopShell.Framework != "tauri" || !safeRelative(manifest.DesktopShell.Entrypoint) || !safeRelative(manifest.DesktopShell.StableLauncher) || !safeRelative(manifest.DesktopShell.Icon) {
			return Manifest{}, errors.New("desktop shell manifest is invalid")
		}
		entrypointCovered := false
		prefix := strings.TrimSuffix(filepath.ToSlash(manifest.DesktopShell.Entrypoint), "/") + "/"
		for relative := range checksums {
			if relative == manifest.DesktopShell.Entrypoint || strings.HasPrefix(relative, prefix) {
				entrypointCovered = true
				break
			}
		}
		if !entrypointCovered {
			return Manifest{}, errors.New("checksums omit desktop shell entrypoint")
		}
		if _, ok := checksums[manifest.DesktopShell.StableLauncher]; !ok {
			return Manifest{}, errors.New("checksums omit desktop shell stable launcher")
		}
		if _, ok := checksums[manifest.DesktopShell.Icon]; !ok {
			return Manifest{}, errors.New("checksums omit desktop shell icon")
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
	if opts.DesktopEntryRoot != "" {
		if opts.DesktopEntryRoot, err = filepath.Abs(opts.DesktopEntryRoot); err != nil {
			return opts, err
		}
	}
	if opts.Domain == "" {
		opts.Domain = existingWorkspaceDomain(opts.DataRoot)
		if opts.Domain == "" {
			opts.Domain = "personal-agent.local"
		}
	}
	if opts.Platform == "" {
		opts.Platform = runtime.GOOS
	}
	return opts, nil
}

func existingWorkspaceDomain(dataRoot string) string {
	data, err := os.ReadFile(filepath.Join(dataRoot, "config", "site.json"))
	if err != nil {
		return ""
	}
	var site struct {
		ASCIIName string `json:"asciiDomain"`
	}
	if json.Unmarshal(data, &site) != nil {
		return ""
	}
	return strings.TrimSpace(site.ASCIIName)
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
		waitForSupervisorShutdown(ctx, opts.DataRoot, 5*time.Second)
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
		_, _ = runner.Run(ctx, "schtasks.exe", []string{"/Delete", "/TN", "PrivateSiteNode", "/F"}, env)
		return nil
	default:
		return fmt.Errorf("unsupported service platform: %s", opts.Platform)
	}
}

func stopSupervisor(ctx context.Context, opts Options, releaseRoot string, runner Runner, env []string) error {
	node := bundledNode(releaseRoot, opts.Platform)
	entrypoint := privateSiteEntrypoint(releaseRoot)
	if _, err := runner.Run(ctx, node, []string{entrypoint, "stop", "--data-root", opts.DataRoot}, env); err != nil {
		return err
	}
	waitForSupervisorShutdown(ctx, opts.DataRoot, 10*time.Second)
	return nil
}

func waitForSupervisorShutdown(ctx context.Context, dataRoot string, timeout time.Duration) {
	statusPath := filepath.Join(dataRoot, "runtime", "supervisor.json")
	deadline := time.Now().Add(timeout)
	for {
		var status struct {
			State string `json:"status"`
		}
		data, err := os.ReadFile(statusPath)
		if errors.Is(err, os.ErrNotExist) || (err == nil && json.Unmarshal(data, &status) == nil && status.State == "stopped") {
			return
		}
		if time.Now().After(deadline) {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(100 * time.Millisecond):
		}
	}
}

func replacePointer(linkPath, target, platform string, runner Runner) error {
	_ = runner
	if err := removePointer(linkPath); err != nil {
		return err
	}
	if platform == "windows" {
		return writePointerFile(linkPath, target)
	}
	err := os.Symlink(filepath.Base(filepath.Dir(target))+string(filepath.Separator)+filepath.Base(target), linkPath)
	if err != nil && runtime.GOOS == "windows" {
		return writePointerFile(linkPath, target)
	}
	return err
}

func writePointerFile(linkPath, target string) error {
	if info, err := os.Stat(target); err != nil || !info.IsDir() {
		return fmt.Errorf("pointer target is not a directory: %s", target)
	}
	temporary := fmt.Sprintf("%s.%d.tmp", linkPath, os.Getpid())
	if err := os.WriteFile(temporary, []byte(filepath.Clean(target)+"\n"), 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, linkPath)
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

func installedReleaseMatches(target string, expected Manifest, nodeRuntime, platform string) bool {
	installed, err := VerifyRelease(target)
	if err != nil || installed.ReleaseID != expected.ReleaseID || installed.Revision != expected.Revision || installed.Dirty {
		return false
	}
	installedNodeDigest, err := sha256File(bundledNode(target, platform))
	if err != nil {
		return false
	}
	expectedNodeDigest, err := sha256File(nodeRuntime)
	return err == nil && installedNodeDigest == expectedNodeDigest
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

func openDesktopShell(ctx context.Context, url string, opts Options, runner Runner, env []string) error {
	if opts.Platform == "darwin" {
		application := filepath.Join(userHome(), "Applications", "Personal Agent.app")
		_, err := runner.Run(ctx, "open", []string{"-a", application, "--args", "--url", url}, env)
		return err
	}
	launcher := filepath.Join(opts.InstallRoot, "bin", "personal-agent-ui")
	if opts.Platform == "windows" {
		launcher += ".exe"
	}
	_, err := runner.Run(ctx, launcher, []string{"--url", url}, env)
	return err
}

func commitDesktopIntegration(opts Options, releaseRoot string, manifest Manifest, state map[string]any, runner Runner, env []string) (returnedErr error) {
	paths := []string{filepath.Join(opts.InstallRoot, "installation.json")}
	launcherNames := []string{"personal-agent"}
	if manifest.DesktopShell != nil {
		launcherNames = append(launcherNames, "personal-agent-ui")
	}
	for _, base := range launcherNames {
		name := base
		if opts.Platform == "windows" {
			name += ".exe"
		}
		paths = append(paths, filepath.Join(opts.InstallRoot, "bin", name))
	}
	if manifest.DesktopShell != nil && opts.Platform == "windows" {
		paths = append(paths, filepath.Join(opts.InstallRoot, "bin", "personal-agent.ico"))
	}
	if manifest.DesktopShell != nil && !opts.SkipDesktopEntry {
		entryPaths, err := desktopEntryPaths(opts)
		if err != nil {
			return err
		}
		paths = append(paths, entryPaths...)
	}
	snapshots, err := snapshotPaths(paths)
	if err != nil {
		return err
	}
	defer func() {
		if returnedErr != nil {
			restoreSnapshots(snapshots)
		}
	}()

	for _, base := range launcherNames {
		name := base
		if opts.Platform == "windows" {
			name += ".exe"
		}
		source := filepath.Join(releaseRoot, name)
		if _, statErr := os.Stat(source); statErr == nil {
			if err := copyFile(source, filepath.Join(opts.InstallRoot, "bin", name), 0o700); err != nil {
				return fmt.Errorf("install stable launcher %s: %w", base, err)
			}
		}
	}
	if manifest.DesktopShell != nil && opts.Platform == "windows" {
		if err := copyFile(filepath.Join(releaseRoot, filepath.FromSlash(manifest.DesktopShell.Icon)), filepath.Join(opts.InstallRoot, "bin", "personal-agent.ico"), 0o600); err != nil {
			return fmt.Errorf("install desktop icon: %w", err)
		}
	}
	if manifest.DesktopShell != nil && !opts.SkipDesktopEntry {
		if err := installDesktopEntry(opts, runner, env); err != nil {
			return fmt.Errorf("install desktop entry: %w", err)
		}
	}
	if err := writeJSON(filepath.Join(opts.InstallRoot, "installation.json"), state, 0o600); err != nil {
		return err
	}
	return nil
}

func snapshotPaths(paths []string) ([]pathSnapshot, error) {
	snapshots := make([]pathSnapshot, 0, len(paths))
	seen := map[string]bool{}
	for _, target := range paths {
		target = filepath.Clean(target)
		if seen[target] {
			continue
		}
		seen[target] = true
		snapshot := pathSnapshot{path: target}
		info, err := os.Lstat(target)
		if errors.Is(err, os.ErrNotExist) {
			snapshots = append(snapshots, snapshot)
			continue
		}
		if err != nil {
			return nil, err
		}
		snapshot.exists = true
		snapshot.mode = info.Mode()
		if info.Mode()&os.ModeSymlink != 0 {
			snapshot.symlink, err = os.Readlink(target)
		} else if info.Mode().IsRegular() {
			snapshot.data, err = os.ReadFile(target)
		} else {
			return nil, fmt.Errorf("desktop integration path is not a file or symlink: %s", target)
		}
		if err != nil {
			return nil, err
		}
		snapshots = append(snapshots, snapshot)
	}
	return snapshots, nil
}

func restoreSnapshots(snapshots []pathSnapshot) {
	for index := len(snapshots) - 1; index >= 0; index-- {
		snapshot := snapshots[index]
		_ = os.Remove(snapshot.path)
		if !snapshot.exists {
			continue
		}
		_ = os.MkdirAll(filepath.Dir(snapshot.path), 0o700)
		if snapshot.mode&os.ModeSymlink != 0 {
			_ = os.Symlink(snapshot.symlink, snapshot.path)
		} else {
			_ = os.WriteFile(snapshot.path, snapshot.data, snapshot.mode.Perm())
		}
	}
}

func installDesktopEntry(opts Options, runner Runner, env []string) error {
	launcher := filepath.Join(opts.InstallRoot, "bin", "personal-agent-ui")
	switch opts.Platform {
	case "windows":
		launcher += ".exe"
		entries, err := desktopEntryPaths(opts)
		if err != nil {
			return err
		}
		for _, entry := range entries[:2] {
			if err := os.MkdirAll(filepath.Dir(entry), 0o700); err != nil {
				return err
			}
		}
		script := `$shell=New-Object -ComObject WScript.Shell;foreach($path in @($env:PERSONAL_AGENT_START_SHORTCUT,$env:PERSONAL_AGENT_DESKTOP_SHORTCUT)){$shortcut=$shell.CreateShortcut($path);$shortcut.TargetPath=$env:PERSONAL_AGENT_UI_LAUNCHER;$shortcut.WorkingDirectory=$env:PERSONAL_AGENT_UI_WORKDIR;$shortcut.IconLocation=$env:PERSONAL_AGENT_UI_ICON;$shortcut.Description='Personal Agent';$shortcut.Save()}`
		desktopEnv := append(env,
			"PERSONAL_AGENT_START_SHORTCUT="+entries[0],
			"PERSONAL_AGENT_DESKTOP_SHORTCUT="+entries[1],
			"PERSONAL_AGENT_UI_LAUNCHER="+launcher,
			"PERSONAL_AGENT_UI_WORKDIR="+opts.InstallRoot,
			"PERSONAL_AGENT_UI_ICON="+filepath.Join(opts.InstallRoot, "bin", "personal-agent.ico")+",0",
		)
		_, err = runner.Run(context.Background(), "powershell.exe", []string{"-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script}, desktopEnv)
		if err != nil {
			return err
		}
		if len(entries) > 2 {
			_ = os.Remove(entries[2])
		}
		return nil
	case "darwin":
		entries, err := desktopEntryPaths(opts)
		if err != nil {
			return err
		}
		entry := entries[0]
		if err := os.MkdirAll(filepath.Dir(entry), 0o700); err != nil {
			return err
		}
		if info, err := os.Lstat(entry); err == nil {
			if info.Mode()&os.ModeSymlink == 0 {
				return errors.New("refusing to replace an existing non-symlink Personal Agent.app")
			}
			if err := os.Remove(entry); err != nil {
				return err
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return os.Symlink(filepath.Join(opts.InstallRoot, "current", "desktop", "Personal Agent.app"), entry)
	case "linux":
		entries, err := desktopEntryPaths(opts)
		if err != nil {
			return err
		}
		entry := entries[0]
		if err := os.MkdirAll(filepath.Dir(entry), 0o700); err != nil {
			return err
		}
		icon := filepath.Join(opts.InstallRoot, "current", "desktop", "icon.svg")
		body := fmt.Sprintf("[Desktop Entry]\nType=Application\nName=Personal Agent\nComment=Local-first Personal Agent\nExec=%s\nIcon=%s\nTerminal=false\nCategories=Utility;\n", desktopExecValue(launcher), icon)
		return os.WriteFile(entry, []byte(body), 0o600)
	default:
		return fmt.Errorf("unsupported desktop platform: %s", opts.Platform)
	}
}

func removeDesktopEntry(installRoot, platform string) error {
	entries, err := desktopEntryPaths(Options{InstallRoot: installRoot, Platform: platform})
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if platform == "darwin" {
			if info, statErr := os.Lstat(entry); statErr == nil && info.Mode()&os.ModeSymlink == 0 {
				return errors.New("refusing to remove a non-symlink Personal Agent.app")
			}
		}
		if removeErr := os.Remove(entry); removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			return removeErr
		}
	}
	return nil
}

func desktopEntryPaths(opts Options) ([]string, error) {
	switch opts.Platform {
	case "windows":
		if opts.DesktopEntryRoot != "" {
			return []string{
				filepath.Join(opts.DesktopEntryRoot, "Programs", "Personal Agent", "Personal Agent.lnk"),
				filepath.Join(opts.DesktopEntryRoot, "Desktop", "Personal Agent.lnk"),
				filepath.Join(opts.DesktopEntryRoot, "Programs", "Personal Agent.lnk"),
			}, nil
		}
		configRoot, err := os.UserConfigDir()
		if err != nil {
			return nil, err
		}
		programs := filepath.Join(configRoot, "Microsoft", "Windows", "Start Menu", "Programs")
		return []string{
			filepath.Join(programs, "Personal Agent", "Personal Agent.lnk"),
			filepath.Join(userHome(), "Desktop", "Personal Agent.lnk"),
			filepath.Join(programs, "Personal Agent.lnk"),
		}, nil
	case "darwin":
		return []string{filepath.Join(userHome(), "Applications", "Personal Agent.app")}, nil
	case "linux":
		return []string{filepath.Join(userHome(), ".local", "share", "applications", "personal-agent.desktop")}, nil
	default:
		return nil, fmt.Errorf("unsupported desktop platform: %s", opts.Platform)
	}
}

func desktopExecValue(value string) string {
	return `"` + strings.NewReplacer("\\", "\\\\", "\"", "\\\"", "`", "\\`").Replace(value) + `"`
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
