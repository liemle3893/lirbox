package schedules

import "context"

// Run executes one scheduled occurrence.
func (w *Worker) Run(ctx context.Context, args RunScheduleArgs) error {
	sched, err := w.load(ctx, args.ScheduleID)
	if err != nil {
		return err
	}
	targets, err := w.Resolver.Resolve(ctx, sched.OwnerID, sched.TargetGroupIDs, nil)
	if err != nil {
		return err
	}
	sent, failed := w.fanOut(ctx, sched, targets)
	_, err = w.Pool.Exec(ctx, `
		UPDATE schedule_runs SET status = $2, sent_count = $3, failed_count = $4,
		       finished_at = now()
		WHERE id = $1`, args.RunID, statusOf(sent, failed), sent, failed)
	return err
}
