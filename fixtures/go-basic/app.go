package main

import (
	"fmt"

	"example.com/app/store"
	"example.com/app/util"
)

type Base struct{}

func (b *Base) Ping() {}

type App struct {
	*Base
	util.Logger
	db    *util.DB
	items []Item
}

type Item struct{}

func (i Item) Run() {}

func NewApp(db *util.DB) *App { return &App{db: db} }

func (a *App) Start() {
	a.Ping()
	a.Log("start")
	rows := a.db.Query("select")
	for _, r := range rows {
		r.Describe()
	}
	for _, it := range a.items {
		it.Run()
	}
	a.items[0].Run()
	a.helper()
	run := func(a *App) { a.helper() }
	run(a)
	fmt.Println(store.Debug.String())
}

func (a *App) helper() {}

func main() {
	db, _ := util.Open("x")
	app := NewApp(db)
	app.Start()
	NewApp(nil).Start()
	new(App).Start()
	store.Default.Get("k")
	s := store.New()
	s.Get("k")
	fmt.Println(util.Platform())
}
