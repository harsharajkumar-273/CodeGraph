package store

import "example.com/app/util"

type Store interface {
	Get(key string) string
}

type memStore struct {
	data map[string]string
}

func (m *memStore) Get(key string) string { return m.data[key] }

func New() Store { return &memStore{data: map[string]string{}} }

var Default = New()

type Level int

const (
	Debug Level = iota
	Info
)

func (l Level) String() string { return util.Hash("level") }
