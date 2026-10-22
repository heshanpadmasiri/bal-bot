//go:build js && wasm

package main

import (
	"balbot/compiler"
	"encoding/json"
	"fmt"
	"syscall/js"
)

func checkJSON(request string) (response string) {
	failure := func(err any) string {
		data, _ := json.Marshal(map[string]any{"kind": "failure", "message": fmt.Sprint(err)})
		return string(data)
	}
	defer func() {
		if p := recover(); p != nil {
			response = failure(fmt.Sprintf("compiler panic: %v", p))
		}
	}()
	var input struct {
		Files compiler.Files `json:"files"`
	}
	if err := json.Unmarshal([]byte(request), &input); err != nil {
		return failure(err)
	}
	result, err := compiler.Check(input.Files)
	if err != nil {
		return failure(err)
	}
	data, err := json.Marshal(map[string]any{"kind": "result", "result": result})
	if err != nil {
		return failure(err)
	}
	return string(data)
}
func main() {
	callback := js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 1 || args[0].Type() != js.TypeString {
			return `{"kind":"failure","message":"Invalid bridge request"}`
		}
		return checkJSON(args[0].String())
	})
	defer callback.Release()
	js.Global().Set("balBotCheck", callback)
	js.Global().Call("balBotReady")
	select {}
}
