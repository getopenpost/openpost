package main

import (
	"context"

	apiroutes "github.com/openpost/backend/internal/api"
)

type webProcess interface {
	Shutdown(context.Context) error
}

type workerProcess interface {
	Quiesce()
	Wait(context.Context) error
}

// drainRuntime removes the process from readiness first, then drains every
// active role under the caller's single termination deadline.
func drainRuntime(
	ctx context.Context,
	readiness *apiroutes.Readiness,
	web webProcess,
	worker workerProcess,
) []error {
	readiness.BeginDrain()
	operationCount := 0
	results := make(chan error, 2)
	if web != nil {
		operationCount++
		go func() { results <- web.Shutdown(ctx) }()
	}
	if worker != nil {
		worker.Quiesce()
		operationCount++
		go func() { results <- worker.Wait(ctx) }()
	}

	errors := make([]error, 0, operationCount)
	for range operationCount {
		select {
		case err := <-results:
			if err != nil {
				errors = append(errors, err)
			}
		case <-ctx.Done():
			return append(errors, ctx.Err())
		}
	}
	return errors
}
