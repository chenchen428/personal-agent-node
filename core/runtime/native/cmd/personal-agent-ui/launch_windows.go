//go:build windows

package main

import "os/exec"

func configureDetachedLaunch(_ *exec.Cmd) {}
