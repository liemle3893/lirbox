package ledger

import (
	"context"
	"fmt"
	"time"
)

// Entry is one append-only ledger record.
type Entry struct {
	ID        string
	Kind      string
	CreatedAt time.Time
}

type Store interface {
	Insert(ctx context.Context, e Entry) error
}

// Append writes one entry. It already takes a context and threads it to the store.
func Append(ctx context.Context, s Store, e Entry) error {
	if e.ID == "" {
		return fmt.Errorf("ledger: empty id")
	}
	e.CreatedAt = time.Now().UTC()
	return s.Insert(ctx, e)
}

// Compact is a placeholder: it currently drops nothing and returns the input count.
func Compact(ctx context.Context, s Store, before time.Time) (int, error) {
	return 0, nil
}
