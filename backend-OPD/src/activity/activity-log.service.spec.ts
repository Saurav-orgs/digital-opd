import { ActivityLogService } from './activity-log.service';
import { ActivityAction, ActivityActor } from '../common/enums';

/**
 * The point of this service is that routine activity must NOT cost one INSERT
 * per action, while the rows that matter must never wait in memory. Both halves
 * are invisible in normal use and would regress silently, so they are asserted
 * here directly.
 */
describe('ActivityLogService', () => {
  let calls: any[][];
  let model: any;
  let service: ActivityLogService;

  const entry = (action: ActivityAction) => ({
    action,
    summary: 's',
    actor_type: ActivityActor.USER,
    actor_label: 'Tester',
  });

  beforeEach(() => {
    calls = [];
    model = { bulkCreate: jest.fn(async (rows: any[]) => { calls.push(rows); }) };
    service = new ActivityLogService(model);
  });

  afterEach(async () => {
    await service.onApplicationShutdown();
  });

  it('writes security events straight through, without waiting', async () => {
    service.record(entry(ActivityAction.LOGIN));
    await Promise.resolve();
    expect(model.bulkCreate).toHaveBeenCalledTimes(1);
    expect(calls[0]).toHaveLength(1);
  });

  it('writes an issued prescription straight through', async () => {
    service.record(entry(ActivityAction.PRESCRIPTION_ISSUED));
    await Promise.resolve();
    expect(model.bulkCreate).toHaveBeenCalledTimes(1);
  });

  it('does not touch the database for routine activity', async () => {
    for (let i = 0; i < 20; i++) service.record(entry(ActivityAction.APPOINTMENT_BOOKED));
    await Promise.resolve();
    expect(model.bulkCreate).not.toHaveBeenCalled();
  });

  it('writes buffered rows as ONE insert, not one per action', async () => {
    for (let i = 0; i < 20; i++) service.record(entry(ActivityAction.APPOINTMENT_BOOKED));
    await service.onApplicationShutdown();
    expect(model.bulkCreate).toHaveBeenCalledTimes(1);
    expect(calls[0]).toHaveLength(20);
  });

  it('flushes early once the buffer reaches its threshold', async () => {
    for (let i = 0; i < 100; i++) service.record(entry(ActivityAction.APPOINTMENT_BOOKED));
    await Promise.resolve();
    expect(model.bulkCreate).toHaveBeenCalledTimes(1);
    expect(calls[0]).toHaveLength(100);
  });

  it('never throws into the caller when the database rejects the write', async () => {
    model.bulkCreate = jest.fn(async () => { throw new Error('db is down'); });
    expect(() => service.record(entry(ActivityAction.LOGIN))).not.toThrow();
    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
  });

  it('persists what is still buffered when the process shuts down', async () => {
    service.record(entry(ActivityAction.APPOINTMENT_BOOKED));
    expect(model.bulkCreate).not.toHaveBeenCalled();
    await service.onApplicationShutdown();
    expect(calls[0]).toHaveLength(1);
  });

  it('truncates over-long labels rather than failing the insert', async () => {
    service.record({ ...entry(ActivityAction.LOGIN), actor_label: 'x'.repeat(500) });
    await Promise.resolve();
    expect(calls[0][0].actor_label).toHaveLength(160);
  });
});
