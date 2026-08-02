package schedules

import "context"

// Resolve expands group and tag ids into concrete send targets.
func (r *Resolver) Resolve(ctx context.Context, owner string, groups, tags []string) ([]Target, error) {
	return r.query(ctx, owner, groups, tags)
}
