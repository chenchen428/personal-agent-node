package embedded

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"
)

func TestExtractVerifiesAndUnpacksAppendedPayload(t *testing.T) {
	payload := payloadArchive(t, map[string]string{"release/release-manifest.json": `{}`, "node/" + nodeName(): "node"})
	executable := filepath.Join(t.TempDir(), "setup")
	binary := append([]byte("native-binary"), payload...)
	binary = append(binary, Footer(payload)...)
	if err := os.WriteFile(executable, binary, 0o700); err != nil {
		t.Fatal(err)
	}
	result, err := Extract(executable, filepath.Join(t.TempDir(), "out"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(result.NodeRuntime); err != nil {
		t.Fatal(err)
	}

	corrupt, _ := os.ReadFile(executable)
	corrupt[len("native-binary")+2] ^= 0xff
	if err := os.WriteFile(executable, corrupt, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := Extract(executable, filepath.Join(t.TempDir(), "corrupt")); err == nil {
		t.Fatal("corrupt payload was accepted")
	}
}

func payloadArchive(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var output bytes.Buffer
	gzipWriter := gzip.NewWriter(&output)
	tarWriter := tar.NewWriter(gzipWriter)
	for name, content := range files {
		if err := tarWriter.WriteHeader(&tar.Header{Name: name, Mode: 0o700, Size: int64(len(content)), Typeflag: tar.TypeReg}); err != nil {
			t.Fatal(err)
		}
		if _, err := tarWriter.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}
