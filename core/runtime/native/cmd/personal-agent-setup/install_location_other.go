//go:build !windows

package main

func selectInstallHome(defaultPath string) (string, bool, error) {
	return defaultPath, true, nil
}
