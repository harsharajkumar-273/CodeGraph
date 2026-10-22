//go:build !windows

package util

func platform() string { return "unix" }

func Platform() string { return platform() }
