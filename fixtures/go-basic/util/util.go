package util

// Logger is embedded by other types, so its methods are promoted to them.
type Logger struct{}

func (l *Logger) Log(msg string) {}

type DB struct{}

func (d *DB) Query(q string) []Row { return nil }

type Row struct{ ID int }

func (r Row) Describe() string { return "" }

func Open(path string) (*DB, error) { return &DB{}, nil }

func Hash(s string) string { return s }
