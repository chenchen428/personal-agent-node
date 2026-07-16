package runtimeconfig

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Roots struct {
	HomeRoot string
	DataRoot string
}

type installationState struct {
	DataRoot string `json:"dataRoot"`
}

func ResolveRoots(installRoot string) (Roots, error) {
	homeRoot := strings.TrimSpace(os.Getenv("PERSONAL_AGENT_HOME"))
	dataRoot := strings.TrimSpace(os.Getenv("PRIVATE_SITE_DATA_ROOT"))
	if dataRoot == "" {
		statePath := filepath.Join(installRoot, "installation.json")
		contents, err := os.ReadFile(statePath)
		if err == nil {
			if len(contents) > 64*1024 {
				return Roots{}, fmt.Errorf("installation state is too large")
			}
			var state installationState
			if err := json.Unmarshal(contents, &state); err != nil {
				return Roots{}, fmt.Errorf("read installation state: %w", err)
			}
			dataRoot = strings.TrimSpace(state.DataRoot)
			if dataRoot == "" {
				return Roots{}, fmt.Errorf("installation state does not define dataRoot")
			}
		} else if !os.IsNotExist(err) {
			return Roots{}, fmt.Errorf("read installation state: %w", err)
		}
	}
	if dataRoot == "" {
		if homeRoot == "" {
			home, err := os.UserHomeDir()
			if err != nil {
				return Roots{}, fmt.Errorf("resolve user home: %w", err)
			}
			homeRoot = filepath.Join(home, ".personal-agent")
		}
		dataRoot = filepath.Join(homeRoot, "workspace")
	}
	if !filepath.IsAbs(dataRoot) {
		return Roots{}, fmt.Errorf("Workspace data root must be absolute")
	}
	dataRoot = filepath.Clean(dataRoot)
	if homeRoot == "" {
		homeRoot = filepath.Dir(dataRoot)
	}
	if !filepath.IsAbs(homeRoot) {
		return Roots{}, fmt.Errorf("Personal Agent home root must be absolute")
	}
	return Roots{HomeRoot: filepath.Clean(homeRoot), DataRoot: dataRoot}, nil
}

func HomeRootForData(dataRoot string) string {
	return filepath.Dir(filepath.Clean(dataRoot))
}
