package main

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestCandidateDigestMatchesRuntimeCanonicalJSON(t *testing.T) {
	binding := candidateBinding{
		SchemaVersion:    1,
		ID:               "op_test",
		Command:          "update candidate apply",
		Risk:             "R3",
		InputSummary:     "Install candidate",
		Target:           "candidate:0.2.0-beta.21:win32-x64",
		StateFingerprint: "old:rev:sha",
		IdempotencyKey:   "candidate:id:sha",
	}
	const expected = "6ecb170a39a5f3dd1b0dba5de6645b4d40044bd1b60289370c52458cf6d69551"
	if actual := candidateDigest(binding); actual != expected {
		t.Fatalf("candidate digest = %s, want %s", actual, expected)
	}
}

func TestCandidateOperationUsesPersonalSpace(t *testing.T) {
	home := t.TempDir()
	personal := filepath.Join(home, "workspace", "spaces", "sp_personal")
	user := filepath.Join(home, "workspace", "spaces", "sp_other")
	for directory, document := range map[string]string{
		personal: `{"schemaVersion":1,"spaceId":"sp_personal","kind":"personal"}`,
		user:     `{"schemaVersion":1,"spaceId":"sp_other","kind":"user"}`,
	} {
		if err := os.MkdirAll(directory, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(directory, "space.json"), []byte(document), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	operationPath, err := candidateOperationPath(home, "op_test")
	if err != nil {
		t.Fatal(err)
	}
	expected := filepath.Join(personal, "runtime", "operations", "op_test.json")
	if filepath.Clean(operationPath) != filepath.Clean(expected) {
		t.Fatalf("operation path = %s, want %s", operationPath, expected)
	}
}

func TestNormalizeUpdateHomeAcceptsLegacyDesktopParent(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, ".personal-agent")
	if err := os.MkdirAll(filepath.Join(home, "core"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "core", "installation.json"), []byte(`{"activeReleaseId":"0.2.0-beta.20"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if actual := normalizeUpdateHome(root); filepath.Clean(actual) != filepath.Clean(home) {
		t.Fatalf("normalized home = %s, want %s", actual, home)
	}
}

func TestUpdateJobRootMatchesRuntimeAndDesktopContract(t *testing.T) {
	home := filepath.Join("root", ".personal-agent")
	expected := filepath.Join(home, "workspace", "installation", "updates")
	if actual := updateJobAllowedRoot(home); actual != expected {
		t.Fatalf("update job root = %s, want %s", actual, expected)
	}
}

func TestCandidateApprovalRequiresCharacterDevices(t *testing.T) {
	input, err := os.CreateTemp(t.TempDir(), "stdin")
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	output, err := os.CreateTemp(t.TempDir(), "stdout")
	if err != nil {
		t.Fatal(err)
	}
	defer output.Close()
	if interactiveTerminal(input, output) {
		t.Fatal("regular files must not satisfy local TTY approval")
	}
}

func TestCandidateSecurityMetadataMustBeChecksummed(t *testing.T) {
	root := t.TempDir()
	security := filepath.Join(root, "CANDIDATE-SECURITY.json")
	if err := os.WriteFile(security, []byte("verified metadata\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	digest, _, err := sha256File(security)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "SHA256SUMS"), []byte(fmt.Sprintf("%s  CANDIDATE-SECURITY.json\n", digest)), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := requireChecksummedFile(root, "CANDIDATE-SECURITY.json"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(security, []byte("tampered\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := requireChecksummedFile(root, "CANDIDATE-SECURITY.json"); err == nil {
		t.Fatal("tampered candidate security metadata must be rejected")
	}
}
