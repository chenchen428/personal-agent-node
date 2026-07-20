//go:build darwin || linux

package main

import (
	"os/exec"
	"testing"
)

func TestDesktopRuntimeLaunchStartsANewSession(t *testing.T) {
	command := exec.Command("true")
	configureDetachedLaunch(command)
	if command.SysProcAttr == nil || !command.SysProcAttr.Setsid {
		t.Fatal("desktop runtime launch must detach from the caller session")
	}
}
