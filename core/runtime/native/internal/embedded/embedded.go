package embedded

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const FooterSize = 64

var magic = [24]byte{'P', 'E', 'R', 'S', 'O', 'N', 'A', 'L', '_', 'A', 'G', 'E', 'N', 'T', '_', 'P', 'A', 'Y', 'L', 'O', 'A', 'D', '_', '1'}

type Payload struct {
	Root        string
	ReleaseRoot string
	NodeRuntime string
}

func Extract(executable, destination string) (Payload, error) {
	file, err := os.Open(executable)
	if err != nil {
		return Payload{}, err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return Payload{}, err
	}
	if info.Size() < FooterSize {
		return Payload{}, errors.New("installer has no embedded payload")
	}
	footer := make([]byte, FooterSize)
	if _, err := file.ReadAt(footer, info.Size()-FooterSize); err != nil {
		return Payload{}, err
	}
	if string(footer[:24]) != string(magic[:]) {
		return Payload{}, errors.New("installer payload footer is missing")
	}
	length := int64(binary.BigEndian.Uint64(footer[24:32]))
	if length <= 0 || length > info.Size()-FooterSize {
		return Payload{}, errors.New("installer payload length is invalid")
	}
	expected := footer[32:64]
	section := io.NewSectionReader(file, info.Size()-FooterSize-length, length)
	hash := sha256.New()
	if _, err := io.Copy(hash, section); err != nil {
		return Payload{}, err
	}
	if !equal(hash.Sum(nil), expected) {
		return Payload{}, errors.New("installer payload checksum mismatch")
	}
	if _, err := section.Seek(0, io.SeekStart); err != nil {
		return Payload{}, err
	}
	if err := extractTarGz(section, destination); err != nil {
		return Payload{}, err
	}
	releaseRoot := filepath.Join(destination, "release")
	nodeRuntime := filepath.Join(destination, "node", nodeName())
	if _, err := os.Stat(filepath.Join(releaseRoot, "release-manifest.json")); err != nil {
		return Payload{}, errors.New("embedded release is missing")
	}
	if _, err := os.Stat(nodeRuntime); err != nil {
		return Payload{}, errors.New("embedded Node runtime is missing")
	}
	return Payload{Root: destination, ReleaseRoot: releaseRoot, NodeRuntime: nodeRuntime}, nil
}

func Footer(payload []byte) []byte {
	footer := make([]byte, FooterSize)
	copy(footer[:24], magic[:])
	binary.BigEndian.PutUint64(footer[24:32], uint64(len(payload)))
	digest := sha256.Sum256(payload)
	copy(footer[32:], digest[:])
	return footer
}

func extractTarGz(input io.Reader, destination string) error {
	gzipReader, err := gzip.NewReader(input)
	if err != nil {
		return err
	}
	defer gzipReader.Close()
	tarReader := tar.NewReader(gzipReader)
	root := filepath.Clean(destination)
	for {
		header, err := tarReader.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		name := filepath.Clean(filepath.FromSlash(header.Name))
		if name == "." || filepath.IsAbs(name) || name == ".." || strings.HasPrefix(name, ".."+string(filepath.Separator)) {
			return fmt.Errorf("unsafe payload path: %s", header.Name)
		}
		target := filepath.Join(root, name)
		if target != root && !strings.HasPrefix(target, root+string(filepath.Separator)) {
			return fmt.Errorf("payload escapes destination: %s", header.Name)
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, os.FileMode(header.Mode)&0o755); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
				return err
			}
			file, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, os.FileMode(header.Mode)&0o755)
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(file, tarReader)
			closeErr := file.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
		case tar.TypeSymlink:
			link := filepath.Clean(filepath.Join(filepath.Dir(target), filepath.FromSlash(header.Linkname)))
			if filepath.IsAbs(header.Linkname) || (link != root && !strings.HasPrefix(link, root+string(filepath.Separator))) {
				return fmt.Errorf("unsafe payload symlink: %s", header.Name)
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
				return err
			}
			if err := os.Symlink(filepath.FromSlash(header.Linkname), target); err != nil {
				return err
			}
		default:
			return fmt.Errorf("unsupported payload member: %s", header.Name)
		}
	}
}

func nodeName() string {
	if filepath.Separator == '\\' {
		return "node.exe"
	}
	return "node"
}

func equal(left, right []byte) bool {
	if len(left) != len(right) {
		return false
	}
	var difference byte
	for index := range left {
		difference |= left[index] ^ right[index]
	}
	return difference == 0
}
