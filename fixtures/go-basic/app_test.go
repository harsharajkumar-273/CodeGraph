package main

import "testing"

func TestStart(t *testing.T) {
	a := NewApp(nil)
	a.Start()
}
