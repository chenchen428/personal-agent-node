package install

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeRunner struct{ calls []string }

func (runner *fakeRunner) Run(_ context.Context, command string, args []string, _ []string) ([]byte, error) {
	runner.calls = append(runner.calls, command+" "+strings.Join(args, " "))
	return []byte(`{"platform":"darwin","serviceId":"site.personal-agent.private-site-node","filePath":"/tmp/source","installPath":"/tmp/target"}`), nil
}

type pointerObservingRunner struct {
	fakeRunner
	current                string
	currentAtCompatibility string
}

func (runner *pointerObservingRunner) Run(ctx context.Context, command string, args []string, env []string) ([]byte, error) {
	if strings.Contains(strings.Join(args, " "), "app-compatibility") {
		runner.currentAtCompatibility = filepath.Base(pointerTarget(runner.current))
	}
	return runner.fakeRunner.Run(ctx, command, args, env)
}

type failingRunner struct {
	fakeRunner
	needle string
}

type lifecycleRunner struct {
	calls      []string
	running    bool
	failNeedle string
}

type missingWindowsTaskRunner struct {
	taskExists bool
}

func (runner *missingWindowsTaskRunner) Run(_ context.Context, command string, args []string, _ []string) ([]byte, error) {
	if command != "schtasks.exe" || len(args) == 0 {
		return []byte(`{}`), nil
	}
	switch args[0] {
	case "/Delete":
		if !runner.taskExists {
			return nil, errors.New("scheduled task not found")
		}
		return nil, errors.New("scheduled task delete denied")
	case "/Query":
		if !runner.taskExists {
			return nil, errors.New("scheduled task not found")
		}
	}
	return []byte(`{}`), nil
}

func (runner *lifecycleRunner) Run(_ context.Context, command string, args []string, _ []string) ([]byte, error) {
	call := command + " " + strings.Join(args, " ")
	runner.calls = append(runner.calls, call)
	if runner.failNeedle != "" && strings.Contains(call, runner.failNeedle) {
		return nil, errors.New("injected candidate failure")
	}
	if strings.Contains(call, "service-prepare") {
		if runner.running {
			return nil, errors.New("service must be stopped before service-prepare")
		}
		return []byte(`{"platform":"windows","serviceId":"PrivateSiteNode","taskName":"PrivateSiteNode","taskXmlPath":"C:\\PrivateSiteNode.xml"}`), nil
	}
	if command == "schtasks.exe" && len(args) > 0 {
		switch args[0] {
		case "/End":
			runner.running = false
		case "/Run":
			runner.running = true
		}
	}
	return []byte(`{}`), nil
}

func TestDeactivateWindowsServiceAcceptsAnAlreadyMissingTask(t *testing.T) {
	runner := &missingWindowsTaskRunner{}
	err := deactivateService(context.Background(), Options{Platform: "windows", DataRoot: t.TempDir()}, runner, nil)
	if err != nil {
		t.Fatalf("missing Windows task should be idempotent: %v", err)
	}
}

func TestDeactivateWindowsServiceReportsARegisteredTaskThatCannotBeDeleted(t *testing.T) {
	runner := &missingWindowsTaskRunner{taskExists: true}
	err := deactivateService(context.Background(), Options{Platform: "windows", DataRoot: t.TempDir()}, runner, nil)
	if err == nil || !strings.Contains(err.Error(), "delete denied") {
		t.Fatalf("expected registered task deletion failure, got %v", err)
	}
}

func (runner *failingRunner) Run(ctx context.Context, command string, args []string, env []string) ([]byte, error) {
	call := command + " " + strings.Join(args, " ")
	runner.calls = append(runner.calls, call)
	if strings.Contains(call, runner.needle) {
		return nil, errors.New("injected candidate failure")
	}
	return []byte(`{"platform":"darwin","serviceId":"site.personal-agent.private-site-node","filePath":"/tmp/source","installPath":"/tmp/target"}`), nil
}

func TestVerifyReleaseRejectsChangedFiles(t *testing.T) {
	release := fixtureRelease(t, "release-one")
	if _, err := VerifyRelease(release); err != nil {
		t.Fatalf("verify fixture: %v", err)
	}
	if err := os.WriteFile(filepath.Join(release, "core/runtime/bin/personal-agent.mjs"), []byte("changed"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyRelease(release); err == nil || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("expected checksum mismatch, got %v", err)
	}
}

func TestDirtyReleaseIsAcceptedOnlyByExplicitLocalAcceptanceVerifier(t *testing.T) {
	release := fixtureRelease(t, "release-local-acceptance")
	manifestPath := filepath.Join(release, "release-manifest.json")
	manifest := map[string]any{}
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	manifest["dirty"] = true
	updated, _ := json.Marshal(manifest)
	if err := os.WriteFile(manifestPath, updated, 0o600); err != nil {
		t.Fatal(err)
	}
	rewriteFixtureChecksums(t, release)
	if _, err := VerifyRelease(release); err == nil {
		t.Fatal("production verifier accepted a dirty release")
	}
	if _, err := VerifyLocalAcceptanceRelease(release); err != nil {
		t.Fatalf("local acceptance verifier rejected its bounded fixture: %v", err)
	}
}

func TestVerifyReleaseRequiresCompleteDesktopShellChecksums(t *testing.T) {
	release := fixtureRelease(t, "release-desktop")
	manifestPath := filepath.Join(release, "release-manifest.json")
	manifest := map[string]any{}
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	manifest["desktopShell"] = map[string]any{
		"framework":      "tauri",
		"platform":       "win32-x64",
		"entrypoint":     "desktop/personal-agent-ui.exe",
		"stableLauncher": "personal-agent-ui.exe",
	}
	updated, _ := json.Marshal(manifest)
	if err := os.WriteFile(manifestPath, updated, 0o600); err != nil {
		t.Fatal(err)
	}
	for relative, content := range map[string][]byte{
		"desktop/personal-agent-ui.exe": []byte("tauri-runtime"),
		"personal-agent-ui.exe":         []byte("stable-launcher"),
	} {
		target := filepath.Join(release, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, content, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	rewriteFixtureChecksums(t, release)
	if _, err := VerifyRelease(release); err != nil {
		t.Fatalf("desktop release should verify: %v", err)
	}
	checksumPath := filepath.Join(release, "SHA256SUMS")
	checksums, err := os.ReadFile(checksumPath)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(checksums)), "\n")
	kept := lines[:0]
	for _, line := range lines {
		if !strings.HasSuffix(line, "  personal-agent-ui.exe") {
			kept = append(kept, line)
		}
	}
	if err := os.WriteFile(checksumPath, []byte(strings.Join(kept, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := VerifyRelease(release); err == nil || !strings.Contains(err.Error(), "stable launcher") {
		t.Fatalf("expected stable launcher checksum rejection, got %v", err)
	}
}

func TestDesktopReleaseAssignsRuntimeLifecycleToClientWithoutRegisteringService(t *testing.T) {
	root := t.TempDir()
	t.Setenv("APPDATA", filepath.Join(root, "appdata"))
	release := desktopFixtureRelease(t, "release-desktop-owned")
	nodeRuntime := filepath.Join(root, "node.exe")
	if err := os.WriteFile(nodeRuntime, []byte("bundled-node"), 0o700); err != nil {
		t.Fatal(err)
	}
	runner := &fakeRunner{}
	result, err := Install(context.Background(), Options{
		ReleaseRoot: release,
		NodeRuntime: nodeRuntime,
		InstallRoot: filepath.Join(root, "install"),
		DataRoot:    filepath.Join(root, "data"),
		NoOpen:      true,
		Platform:    "windows",
	}, runner)
	if err != nil {
		t.Fatal(err)
	}
	if result.Service != "desktop-owned" {
		t.Fatalf("service lifecycle=%q, want desktop-owned", result.Service)
	}
	for _, call := range runner.calls {
		if strings.Contains(call, "service-prepare") || strings.Contains(call, "schtasks.exe") {
			t.Fatalf("desktop-owned install must not register a background service: %s", call)
		}
	}
}

func TestInstallSwitchesCurrentAndRetainsPreviousWithoutHostNode(t *testing.T) {
	root := t.TempDir()
	installRoot := filepath.Join(root, "install")
	dataRoot := filepath.Join(root, "data")
	nodeRuntime := filepath.Join(root, "node")
	if err := os.WriteFile(nodeRuntime, []byte("bundled-node"), 0o700); err != nil {
		t.Fatal(err)
	}
	runner := &fakeRunner{}

	first, err := Install(context.Background(), Options{ReleaseRoot: fixtureRelease(t, "release-one"), NodeRuntime: nodeRuntime, InstallRoot: installRoot, DataRoot: dataRoot, SkipService: true, NoOpen: true, Platform: "darwin"}, runner)
	if err != nil {
		t.Fatal(err)
	}
	if first.ReleaseID != "release-one" || pointerTarget(filepath.Join(installRoot, "current")) == "" {
		t.Fatalf("unexpected first install: %#v", first)
	}
	second, err := Install(context.Background(), Options{ReleaseRoot: fixtureRelease(t, "release-two"), NodeRuntime: nodeRuntime, InstallRoot: installRoot, DataRoot: dataRoot, SkipService: true, NoOpen: true, Platform: "darwin"}, runner)
	if err != nil {
		t.Fatal(err)
	}
	if second.ReleaseID != "release-two" {
		t.Fatalf("unexpected second install: %#v", second)
	}
	previous := pointerTarget(filepath.Join(installRoot, "previous"))
	if filepath.Base(previous) != "release-one" {
		t.Fatalf("previous=%s", previous)
	}
	if len(runner.calls) != 6 {
		t.Fatalf("expected init+app-compatibility+prepare for each install, got %v", runner.calls)
	}
	assertCompatibilityBeforeActivation(t, runner.calls, "release-two")
	if _, err := os.Stat(filepath.Join(pointerTarget(filepath.Join(installRoot, "current")), "runtime", "node")); err != nil {
		t.Fatal(err)
	}

	rolledBack, err := Rollback(context.Background(), installRoot, "darwin", runner)
	if err != nil {
		t.Fatal(err)
	}
	if rolledBack.ReleaseID != "release-one" {
		t.Fatalf("rollback=%#v", rolledBack)
	}
}

func TestInstallAddsMissingWorkspaceSeedWithoutOverwritingUserApps(t *testing.T) {
	root := t.TempDir()
	installRoot := filepath.Join(root, "install")
	dataRoot := filepath.Join(root, "data")
	nodeRuntime := filepath.Join(root, "node")
	if err := os.WriteFile(nodeRuntime, []byte("bundled-node"), 0o700); err != nil {
		t.Fatal(err)
	}
	release := fixtureRelease(t, "release-app-seed")
	seedApp := filepath.Join(release, "workspace", "apps", "personal-agent.daily-brief")
	if err := os.MkdirAll(filepath.Join(seedApp, "dist"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(seedApp, "personal-agent.app.json"), []byte(`{"id":"personal-agent.daily-brief"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(seedApp, "dist", "index.html"), []byte("release app"), 0o600); err != nil {
		t.Fatal(err)
	}
	rewriteFixtureChecksums(t, release)

	userApp := filepath.Join(dataRoot, "apps", "personal-agent.daily-brief", "dist")
	if err := os.MkdirAll(userApp, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(userApp, "index.html"), []byte("user customized app"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := Install(context.Background(), Options{
		ReleaseRoot: release, NodeRuntime: nodeRuntime, InstallRoot: installRoot,
		DataRoot: dataRoot, SkipService: true, NoOpen: true, Platform: "darwin",
	}, &fakeRunner{}); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(filepath.Join(userApp, "index.html"))
	if err != nil || string(content) != "user customized app" {
		t.Fatalf("user App was overwritten: %q %v", content, err)
	}
	if _, err := os.Stat(filepath.Join(dataRoot, "apps", "personal-agent.daily-brief", "personal-agent.app.json")); err != nil {
		t.Fatalf("missing App seed file was not installed: %v", err)
	}
}

func assertCompatibilityBeforeActivation(t *testing.T, calls []string, release string) {
	t.Helper()
	compatibility := -1
	prepare := -1
	for index, call := range calls {
		if strings.Contains(call, release) && strings.Contains(call, "app-compatibility") {
			compatibility = index
		}
		if strings.Contains(call, release) && strings.Contains(call, " prepare ") {
			prepare = index
		}
	}
	if compatibility == -1 || prepare == -1 || compatibility >= prepare {
		t.Fatalf("App compatibility must precede %s activation preparation: %v", release, calls)
	}
}

func TestUpgradeChecksAppCompatibilityBeforeSwitchingCurrent(t *testing.T) {
	root := t.TempDir()
	installRoot := filepath.Join(root, "install")
	dataRoot := filepath.Join(root, "data")
	nodeRuntime := filepath.Join(root, "node")
	if err := os.WriteFile(nodeRuntime, []byte("bundled-node"), 0o700); err != nil {
		t.Fatal(err)
	}
	options := func(release string) Options {
		return Options{ReleaseRoot: fixtureRelease(t, release), NodeRuntime: nodeRuntime, InstallRoot: installRoot, DataRoot: dataRoot, SkipService: true, NoOpen: true, Platform: "darwin"}
	}
	if _, err := Install(context.Background(), options("release-one"), &fakeRunner{}); err != nil {
		t.Fatal(err)
	}
	runner := &pointerObservingRunner{current: filepath.Join(installRoot, "current")}
	if _, err := Install(context.Background(), options("release-two"), runner); err != nil {
		t.Fatal(err)
	}
	if runner.currentAtCompatibility != "release-one" {
		t.Fatalf("compatibility ran after current switched: observed %q", runner.currentAtCompatibility)
	}
}

func TestInstallPreservesExistingWorkspaceDomainWhenOmitted(t *testing.T) {
	root := t.TempDir()
	installRoot := filepath.Join(root, "install")
	dataRoot := filepath.Join(root, "data")
	if err := os.MkdirAll(filepath.Join(dataRoot, "config"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataRoot, "config", "site.json"), []byte(`{"asciiDomain":"owner.example"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	nodeRuntime := filepath.Join(root, "node")
	if err := os.WriteFile(nodeRuntime, []byte("bundled-node"), 0o700); err != nil {
		t.Fatal(err)
	}
	runner := &fakeRunner{}
	if _, err := Install(context.Background(), Options{ReleaseRoot: fixtureRelease(t, "release-domain"), NodeRuntime: nodeRuntime, InstallRoot: installRoot, DataRoot: dataRoot, SkipService: true, NoOpen: true, Platform: "darwin"}, runner); err != nil {
		t.Fatal(err)
	}
	if len(runner.calls) == 0 || !strings.Contains(runner.calls[0], "init --domain owner.example") {
		t.Fatalf("existing Workspace domain was not preserved: %v", runner.calls)
	}
}

func TestFailedCandidateRestoresPointers(t *testing.T) {
	root := t.TempDir()
	installRoot := filepath.Join(root, "install")
	dataRoot := filepath.Join(root, "data")
	nodeRuntime := filepath.Join(root, "node")
	if err := os.WriteFile(nodeRuntime, []byte("bundled-node"), 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := Install(context.Background(), Options{ReleaseRoot: fixtureRelease(t, "release-one"), NodeRuntime: nodeRuntime, InstallRoot: installRoot, DataRoot: dataRoot, SkipService: true, NoOpen: true, Platform: "darwin"}, &fakeRunner{}); err != nil {
		t.Fatal(err)
	}
	runner := &failingRunner{needle: "release-two"}
	if _, err := Install(context.Background(), Options{ReleaseRoot: fixtureRelease(t, "release-two"), NodeRuntime: nodeRuntime, InstallRoot: installRoot, DataRoot: dataRoot, SkipService: true, NoOpen: true, Platform: "darwin"}, runner); err == nil {
		t.Fatal("expected candidate failure")
	}
	if got := filepath.Base(pointerTarget(filepath.Join(installRoot, "current"))); got != "release-one" {
		t.Fatalf("current=%s", got)
	}
	if got := pointerTarget(filepath.Join(installRoot, "previous")); got != "" {
		t.Fatalf("unexpected previous after failed candidate: %s", got)
	}
}

func TestUpgradeStopsManagedServiceBeforeCandidatePreparation(t *testing.T) {
	root := t.TempDir()
	installRoot := filepath.Join(root, "install")
	dataRoot := filepath.Join(root, "data")
	nodeRuntime := filepath.Join(root, "node.exe")
	if err := os.WriteFile(nodeRuntime, []byte("bundled-node"), 0o700); err != nil {
		t.Fatal(err)
	}
	runner := &lifecycleRunner{}
	opts := func(release string) Options {
		return Options{ReleaseRoot: fixtureRelease(t, release), NodeRuntime: nodeRuntime, InstallRoot: installRoot, DataRoot: dataRoot, SkipStartWait: true, NoOpen: true, Platform: "windows"}
	}
	if _, err := Install(context.Background(), opts("release-one"), runner); err != nil {
		t.Fatal(err)
	}
	if !runner.running {
		t.Fatal("first install did not start the managed service")
	}
	start := len(runner.calls)
	if _, err := Install(context.Background(), opts("release-two"), runner); err != nil {
		t.Fatal(err)
	}
	assertStoppedBeforePrepare(t, runner.calls[start:], "release-two")
	if !runner.running {
		t.Fatal("upgrade did not restart the managed service")
	}

	start = len(runner.calls)
	rolledBack, err := Rollback(context.Background(), installRoot, "windows", runner)
	if err != nil {
		t.Fatal(err)
	}
	if rolledBack.ReleaseID != "release-one" {
		t.Fatalf("rollback=%#v", rolledBack)
	}
	assertStoppedBeforePrepare(t, runner.calls[start:], "release-one")
	if !runner.running {
		t.Fatal("rollback did not restart the managed service")
	}
}

func TestFailedManagedUpgradeRestoresPointersAndService(t *testing.T) {
	root := t.TempDir()
	installRoot := filepath.Join(root, "install")
	dataRoot := filepath.Join(root, "data")
	nodeRuntime := filepath.Join(root, "node.exe")
	if err := os.WriteFile(nodeRuntime, []byte("bundled-node"), 0o700); err != nil {
		t.Fatal(err)
	}
	runner := &lifecycleRunner{}
	base := Options{ReleaseRoot: fixtureRelease(t, "release-one"), NodeRuntime: nodeRuntime, InstallRoot: installRoot, DataRoot: dataRoot, SkipStartWait: true, NoOpen: true, Platform: "windows"}
	if _, err := Install(context.Background(), base, runner); err != nil {
		t.Fatal(err)
	}
	runner.failNeedle = "release-two"
	candidate := base
	candidate.ReleaseRoot = fixtureRelease(t, "release-two")
	if _, err := Install(context.Background(), candidate, runner); err == nil {
		t.Fatal("expected candidate failure")
	}
	if got := filepath.Base(pointerTarget(filepath.Join(installRoot, "current"))); got != "release-one" {
		t.Fatalf("current=%s", got)
	}
	if got := pointerTarget(filepath.Join(installRoot, "previous")); got != "" {
		t.Fatalf("unexpected previous after failed candidate: %s", got)
	}
	if !runner.running {
		t.Fatal("failed upgrade did not restore the previous service")
	}
}

func assertStoppedBeforePrepare(t *testing.T, calls []string, release string) {
	t.Helper()
	stop, prepare := -1, -1
	for index, call := range calls {
		if stop == -1 && strings.Contains(call, "schtasks.exe /End") {
			stop = index
		}
		if prepare == -1 && strings.Contains(call, release) && strings.Contains(call, "service-prepare") {
			prepare = index
		}
	}
	if stop == -1 || prepare == -1 || stop >= prepare {
		t.Fatalf("service stop must precede %s service preparation: %v", release, calls)
	}
}

func TestWindowsPointersUseAtomicFilesWithoutShell(t *testing.T) {
	root := t.TempDir()
	installRoot := filepath.Join(root, "install")
	dataRoot := filepath.Join(root, "data")
	nodeRuntime := filepath.Join(root, "node.exe")
	if err := os.WriteFile(nodeRuntime, []byte("bundled-node"), 0o700); err != nil {
		t.Fatal(err)
	}
	runner := &fakeRunner{}
	if _, err := Install(context.Background(), Options{ReleaseRoot: fixtureRelease(t, "release-windows"), NodeRuntime: nodeRuntime, InstallRoot: installRoot, DataRoot: dataRoot, SkipService: true, NoOpen: true, Platform: "windows"}, runner); err != nil {
		t.Fatal(err)
	}
	current := filepath.Join(installRoot, "current")
	if info, err := os.Lstat(current); err != nil || !info.Mode().IsRegular() {
		t.Fatalf("Windows pointer must be a regular pointer file: %v", err)
	}
	if got := filepath.Base(pointerTarget(current)); got != "release-windows" {
		t.Fatalf("current=%s", got)
	}
	for _, call := range runner.calls {
		if strings.Contains(strings.ToLower(call), "cmd.exe") || strings.Contains(strings.ToLower(call), "mklink") {
			t.Fatalf("pointer unexpectedly used a shell: %s", call)
		}
	}
}

func TestUninstallRemovesProgramAndPreservesData(t *testing.T) {
	root := t.TempDir()
	installRoot := filepath.Join(root, "install")
	dataRoot := filepath.Join(root, "data")
	if err := os.MkdirAll(dataRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	userFile := filepath.Join(dataRoot, "user-content.txt")
	if err := os.WriteFile(userFile, []byte("preserve me"), 0o600); err != nil {
		t.Fatal(err)
	}
	state, err := json.Marshal(map[string]any{
		"schemaVersion":   2,
		"activeReleaseId": "release-one",
		"dataRoot":        dataRoot,
		"service":         "skipped",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(installRoot, "releases", "release-one"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(installRoot, "installation.json"), state, 0o600); err != nil {
		t.Fatal(err)
	}

	result, err := Uninstall(context.Background(), installRoot, "darwin", &fakeRunner{})
	if err != nil {
		t.Fatal(err)
	}
	if !result.DataPreserved || result.DataRoot != dataRoot {
		t.Fatalf("unexpected uninstall result: %#v", result)
	}
	if _, err := os.Stat(installRoot); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("install root still exists: %v", err)
	}
	if content, err := os.ReadFile(userFile); err != nil || string(content) != "preserve me" {
		t.Fatalf("user data was not preserved: %q %v", content, err)
	}
}

func TestUninstallRejectsUnsafeOrUnrecognizedRoots(t *testing.T) {
	if _, err := Uninstall(context.Background(), string(filepath.Separator), "darwin", &fakeRunner{}); err == nil {
		t.Fatal("expected filesystem root rejection")
	}
	if _, err := Uninstall(context.Background(), t.TempDir(), "darwin", &fakeRunner{}); err == nil || !strings.Contains(err.Error(), "installation.json") {
		t.Fatalf("expected installation marker rejection, got %v", err)
	}
}

func fixtureRelease(t *testing.T, releaseID string) string {
	t.Helper()
	root := filepath.Join(t.TempDir(), releaseID)
	files := map[string][]byte{
		"core/runtime/bin/personal-agent.mjs": []byte("// personal-agent"),
		"core/runtime/bin/private-site.mjs":   []byte("// private-site"),
		"SBOM.cdx.json":                       []byte(`{"bomFormat":"CycloneDX"}`),
	}
	manifest, _ := json.Marshal(map[string]any{"schemaVersion": 2, "releaseType": "personal-agent-node", "releaseId": releaseID, "revision": strings.Repeat("a", 40), "dirty": false})
	files["release-manifest.json"] = manifest
	for relative, content := range files {
		target := filepath.Join(root, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, content, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	lines := make([]string, 0, len(files))
	for relative, content := range files {
		digest := sha256.Sum256(content)
		lines = append(lines, hex.EncodeToString(digest[:])+"  "+relative)
	}
	if err := os.WriteFile(filepath.Join(root, "SHA256SUMS"), []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return root
}

func desktopFixtureRelease(t *testing.T, releaseID string) string {
	t.Helper()
	root := fixtureRelease(t, releaseID)
	manifestPath := filepath.Join(root, "release-manifest.json")
	manifest := map[string]any{}
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		t.Fatal(err)
	}
	manifest["desktopShell"] = map[string]any{
		"framework":      "tauri",
		"platform":       "win32-x64",
		"entrypoint":     "desktop/personal-agent-ui.exe",
		"stableLauncher": "personal-agent-ui.exe",
	}
	updated, _ := json.Marshal(manifest)
	if err := os.WriteFile(manifestPath, updated, 0o600); err != nil {
		t.Fatal(err)
	}
	for relative, content := range map[string][]byte{
		"desktop/personal-agent-ui.exe": []byte("tauri-runtime"),
		"personal-agent-ui.exe":         []byte("stable-launcher"),
	} {
		target := filepath.Join(root, filepath.FromSlash(relative))
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, content, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	rewriteFixtureChecksums(t, root)
	return root
}

func rewriteFixtureChecksums(t *testing.T, root string) {
	t.Helper()
	lines := []string{}
	err := filepath.Walk(root, func(target string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() || filepath.Base(target) == "SHA256SUMS" {
			return nil
		}
		data, err := os.ReadFile(target)
		if err != nil {
			return err
		}
		digest := sha256.Sum256(data)
		relative, err := filepath.Rel(root, target)
		if err != nil {
			return err
		}
		lines = append(lines, hex.EncodeToString(digest[:])+"  "+filepath.ToSlash(relative))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "SHA256SUMS"), []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
}
