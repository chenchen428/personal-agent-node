package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
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
		installCommand(nil)
		return
	}
	switch os.Args[1] {
	case "install":
		installCommand(os.Args[2:])
	case "rollback":
		rollbackCommand(os.Args[2:])
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

func installCommand(args []string) {
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
		temporary = filepath.Join(os.TempDir(), fmt.Sprintf("personal-agent-setup-%d", time.Now().UnixNano()))
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
