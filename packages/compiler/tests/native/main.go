// Native model oracle used only by browser parity tests.
package main

import (
	"balbot/compiler"
	"encoding/json"
	"fmt"
	"os"
)

func main() {
	var inputs []compiler.Files
	if err := json.NewDecoder(os.Stdin).Decode(&inputs); err != nil {
		panic(err)
	}
	results := []compiler.AnalysisResult{}
	for _, files := range inputs {
		r, err := compiler.Analyze(files)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		results = append(results, r)
	}
	if err := json.NewEncoder(os.Stdout).Encode(results); err != nil {
		panic(err)
	}
}
