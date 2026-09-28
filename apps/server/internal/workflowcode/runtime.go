// Package workflowcode evaluates pure JavaScript inside a fresh WebAssembly guest.
package workflowcode

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
)

//go:embed qjs.wasm
var engine []byte

var cache = wazero.NewCompilationCache()

const maxBytes = 256 * 1024
const memoryPages = 1024 // 64 MiB, including the engine, stack and JS heap.
const setupTimeout = 30 * time.Second
const executionTimeout = 2 * time.Second

func runtimeConfig() wazero.RuntimeConfig {
	return wazero.NewRuntimeConfig().WithCompilationCache(cache).WithMemoryLimitPages(memoryPages).WithCloseOnContextDone(true)
}

func Evaluate(ctx context.Context, code string, input any) (any, error) {
	data, err := json.Marshal(input)
	if err != nil || len(data) > maxBytes || len(code) > 20000 {
		return nil, errors.New("JavaScript input is too large")
	}
	// Engine startup can be slow under build load; user code gets its own shorter budget.
	ctx, cancel := context.WithTimeout(ctx, setupTimeout)
	defer cancel()
	runtime := wazero.NewRuntimeWithConfig(ctx, runtimeConfig())
	defer runtime.Close(context.Background())
	if _, err := wasi_snapshot_preview1.Instantiate(ctx, runtime); err != nil {
		return nil, err
	}
	// The ABI imports this callback, but OpenPost exposes no Go objects or functions.
	if _, err := runtime.NewHostModuleBuilder("env").NewFunctionBuilder().WithFunc(func(uint32, uint64, uint32, uint32) uint64 { return 0 }).Export("jsFunctionProxy").Instantiate(ctx); err != nil {
		return nil, err
	}
	// No filesystem, environment, stdin, network, or host output is attached.
	compiled, err := runtime.CompileModule(ctx, engine)
	if err != nil {
		return nil, errors.New("JavaScript engine could not compile")
	}
	module, err := runtime.InstantiateModule(ctx, compiled, wazero.NewModuleConfig().WithStartFunctions().WithSysWalltime().WithSysNanotime())
	if err != nil {
		return nil, fmt.Errorf("JavaScript engine could not start: %w", err)
	}
	source := "delete globalThis.std; delete globalThis.os; JSON.stringify((function(){const result = (function(input){\"use strict\";\n" + code + "\n})(" + string(data) + "); if (result && typeof result.then === \"function\") throw new Error(\"Return a JSON value synchronously; asynchronous code is not supported\"); return result;})())"
	return (guest{ctx: ctx, module: module}).evaluate(source)
}

func (g guest) evaluate(source string) (any, error) {
	rt, err := g.call("New_QJS", 32*1024*1024, 256*1024, 0, 0)
	if err != nil {
		return nil, err
	}
	jsctx, err := g.call("QJS_GetContext", rt)
	if err != nil {
		return nil, err
	}
	codePtr, err := g.write(source)
	if err != nil {
		return nil, err
	}
	filePtr, err := g.write("workflow.js")
	if err != nil {
		return nil, err
	}
	options, err := g.call("QJS_CreateEvalOption", codePtr, 0, 0, filePtr, 8)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(g.ctx, executionTimeout)
	defer cancel()
	g.ctx = ctx
	value, err := g.call("QJS_Eval", jsctx, options)
	if err != nil {
		return nil, err
	}
	return g.readResult(jsctx, value)
}

func (g guest) readResult(jsctx, value uint64) (any, error) {
	exception, err := g.call("JS_HasException", jsctx)
	if err != nil {
		return nil, err
	}
	if exception != 0 {
		value, err = g.call("JS_GetException", jsctx)
		if err != nil {
			return nil, err
		}
	}
	packed, err := g.call("QJS_ToCString", jsctx, value)
	if err != nil {
		return nil, err
	}
	location, ok := g.module.Memory().ReadUint64Le(uint32(packed))
	if !ok {
		return nil, errors.New("JavaScript returned no result")
	}
	length := uint32(location)
	if length > maxBytes {
		return nil, errors.New("JavaScript output exceeds 256 KB")
	}
	bytes, ok := g.module.Memory().Read(uint32(location>>32), length)
	if !ok {
		return nil, errors.New("JavaScript returned an invalid result")
	}
	if exception != 0 {
		return nil, fmt.Errorf("JavaScript: %.500s", string(bytes))
	}
	var result any
	if err := json.Unmarshal(bytes, &result); err != nil {
		return nil, errors.New("return a JSON value from JavaScript")
	}
	return result, nil
}

type guest struct {
	ctx    context.Context
	module api.Module
}

func (g guest) call(name string, args ...uint64) (uint64, error) {
	function := g.module.ExportedFunction(name)
	if function == nil {
		return 0, errors.New("JavaScript engine contract is invalid")
	}
	values, err := function.Call(g.ctx, args...)
	if err != nil {
		return 0, errors.New("JavaScript stopped after exceeding its time or memory limit")
	}
	if len(values) == 0 {
		return 0, nil
	}
	return values[0], nil
}
func (g guest) write(value string) (uint64, error) {
	ptr, err := g.call("malloc", uint64(len(value)+1))
	if err != nil {
		return 0, err
	}
	if ptr == 0 || !g.module.Memory().Write(uint32(ptr), append([]byte(value), 0)) {
		return 0, errors.New("JavaScript memory limit exceeded")
	}
	return ptr, nil
}
