import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { schedulesApi } from '../api/endpoints';
import type { Slot } from '../api/types';
import { Loading } from './ui';

const WINDOW_DAYS = 7;

function today() {
  return new Date().toISOString().slice(0, 10);
}

function maxDate() {
  const d = new Date();
  d.setDate(d.getDate() + WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
}

/**
 * Date + slot picker shared by the walk-in form and appointment reschedule —
 * the web equivalent of the Flutter app's `SlotSelector` widget.
 */
export function InlineSlotPicker({
  doctorId,
  onChange,
}: {
  doctorId: string;
  onChange: (date: string | null, slot: Slot | null) => void;
}) {
  const [date, setDate] = useState(today());
  const [selected, setSelected] = useState<Slot | null>(null);

  const slotsQ = useQuery({
    queryKey: ['slots', doctorId, date],
    queryFn: () => schedulesApi.slots(doctorId, date),
    enabled: !!doctorId && !!date,
  });

  const pickDate = (d: string) => {
    setDate(d);
    setSelected(null);
    onChange(null, null);
  };

  const pickSlot = (s: Slot) => {
    setSelected(s);
    onChange(date, s);
  };

  return (
    <div>
      <input
        className="input"
        type="date"
        value={date}
        min={today()}
        max={maxDate()}
        onChange={(e) => pickDate(e.target.value)}
      />
      <div style={{ marginTop: 12 }}>
        {slotsQ.isLoading ? (
          <Loading />
        ) : !slotsQ.data?.available ? (
          <span className="muted">
            {slotsQ.data?.reason === 'leave'
              ? 'On leave this day.'
              : slotsQ.data?.reason === 'no_opd'
                ? 'No OPD hours on this day.'
                : slotsQ.data?.reason === 'out_of_window'
                  ? 'Outside the booking window.'
                  : 'Not available.'}
          </span>
        ) : slotsQ.data.slots.length === 0 ? (
          <span className="muted">No slots for this day.</span>
        ) : (
          <div
            className="grid"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(66px, 1fr))', gap: 6 }}
          >
            {slotsQ.data.slots.map((s) => (
              <div
                key={s.start_time}
                className={`slot slot-${s.status}${s.status === 'available' ? ' slot-pickable' : ''}${
                  selected?.start_time === s.start_time ? ' slot-selected' : ''
                }`}
                onClick={() => s.status === 'available' && pickSlot(s)}
              >
                {s.start_time}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
