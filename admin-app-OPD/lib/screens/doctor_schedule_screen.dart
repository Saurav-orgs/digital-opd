import 'package:flutter/material.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../auth/auth_scope.dart';
import '../theme.dart';
import '../widgets/common.dart';

const _days = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
];
const _durations = [5, 10, 15, 20, 30];

class _Session {
  String startTime;
  String endTime;
  int slotDurationMin;
  _Session(this.startTime, this.endTime, this.slotDurationMin);
}

class DoctorScheduleScreen extends StatefulWidget {
  final String doctorId;
  final String doctorName;
  const DoctorScheduleScreen({
    super.key,
    required this.doctorId,
    required this.doctorName,
  });

  @override
  State<DoctorScheduleScreen> createState() => _DoctorScheduleScreenState();
}

class _DoctorScheduleScreenState extends State<DoctorScheduleScreen> {
  final Map<int, List<_Session>> _byDay = {};
  bool _loading = true;
  bool _saving = false;
  String? _error;

  ApiClient get _api => AuthScope.of(context).api;
  bool get _canEdit => AuthScope.of(context).can('opd_schedules', 'update');

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_loading) _load();
  }

  Future<void> _load() async {
    try {
      final entries = await _api.listSchedules(widget.doctorId);
      _byDay.clear();
      for (final e in entries) {
        (_byDay[e.dayOfWeek] ??= []).add(
            _Session(e.startTime, e.endTime, e.slotDurationMin));
      }
      setState(() => _loading = false);
    } on ApiException catch (e) {
      setState(() {
        _loading = false;
        _error = e.message;
      });
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final entries = <ScheduleEntry>[];
      _byDay.forEach((day, sessions) {
        for (final s in sessions) {
          entries.add(ScheduleEntry(
            dayOfWeek: day,
            startTime: s.startTime,
            endTime: s.endTime,
            slotDurationMin: s.slotDurationMin,
          ));
        }
      });
      await _api.replaceSchedules(widget.doctorId, entries);
      if (mounted) showSuccessSnack(context, 'Schedule saved');
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _pickTime(String current, ValueChanged<String> onPicked) async {
    final parts = current.split(':');
    final initial = TimeOfDay(
        hour: int.tryParse(parts[0]) ?? 11,
        minute: int.tryParse(parts.length > 1 ? parts[1] : '0') ?? 0);
    final picked = await showTimePicker(
        context: context,
        initialTime: initial,
        builder: (c, w) =>
            MediaQuery(data: MediaQuery.of(c).copyWith(alwaysUse24HourFormat: true), child: w!));
    if (picked != null) {
      onPicked(
          '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}');
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('${widget.doctorName} · schedule'),
        actions: [
          if (_canEdit && !_loading)
            TextButton(
              onPressed: _saving ? null : _save,
              child: Text(_saving ? 'Saving…' : 'Save',
                  style: const TextStyle(
                      color: AppColors.primary, fontWeight: FontWeight.w600)),
            ),
        ],
      ),
      body: _loading
          ? const StateView(loading: true)
          : _error != null
              ? StateView(error: _error)
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    const Text(
                      'Add multiple sessions to one day for split OPD (e.g. morning & evening).',
                      style: TextStyle(
                          color: AppColors.textSecondary, fontSize: 13),
                    ),
                    const SizedBox(height: 12),
                    ...List.generate(7, (day) => _dayCard(day)),
                    const SizedBox(height: 12),
                    _LeavePanel(doctorId: widget.doctorId, canEdit: _canEdit),
                    const SizedBox(height: 12),
                    _SlotPreview(doctorId: widget.doctorId),
                  ],
                ),
    );
  }

  Widget _dayCard(int day) {
    final sessions = _byDay[day] ?? [];
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: SectionCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(_days[day],
                    style: const TextStyle(fontWeight: FontWeight.w600)),
                if (_canEdit)
                  TextButton.icon(
                    onPressed: () => setState(() =>
                        (_byDay[day] ??= []).add(_Session('11:00', '14:00', 10))),
                    icon: const Icon(Icons.add, size: 16),
                    label: const Text('Add session'),
                  ),
              ],
            ),
            if (sessions.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 4),
                child: Text('No OPD',
                    style: TextStyle(
                        color: AppColors.textSecondary, fontSize: 13)),
              )
            else
              ...sessions.asMap().entries.map((e) => _sessionRow(day, e.key, e.value)),
          ],
        ),
      ),
    );
  }

  Widget _sessionRow(int day, int idx, _Session s) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          _timeChip(s.startTime, _canEdit
              ? () => _pickTime(s.startTime, (v) => s.startTime = v)
              : null),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 6),
            child: Text('to', style: TextStyle(color: AppColors.textSecondary)),
          ),
          _timeChip(s.endTime, _canEdit
              ? () => _pickTime(s.endTime, (v) => s.endTime = v)
              : null),
          const SizedBox(width: 8),
          _durationDropdown(s),
          if (_canEdit)
            IconButton(
              icon: const Icon(Icons.close, size: 18, color: AppColors.error),
              onPressed: () => setState(() => _byDay[day]!.removeAt(idx)),
            ),
        ],
      ),
    );
  }

  Widget _timeChip(String value, VoidCallback? onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(value),
      ),
    );
  }

  Widget _durationDropdown(_Session s) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.border),
        borderRadius: BorderRadius.circular(8),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<int>(
          value: s.slotDurationMin,
          isDense: true,
          onChanged: _canEdit
              ? (v) => setState(() => s.slotDurationMin = v ?? s.slotDurationMin)
              : null,
          items: _durations
              .map((m) => DropdownMenuItem(value: m, child: Text('$m min')))
              .toList(),
        ),
      ),
    );
  }
}

class _LeavePanel extends StatefulWidget {
  final String doctorId;
  final bool canEdit;
  const _LeavePanel({required this.doctorId, required this.canEdit});

  @override
  State<_LeavePanel> createState() => _LeavePanelState();
}

class _LeavePanelState extends State<_LeavePanel> {
  Future<List<LeaveDay>>? _future;
  final _reason = TextEditingController();
  String? _date;
  bool _busy = false;

  ApiClient get _api => AuthScope.of(context).api;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future ??= _api.listLeave(widget.doctorId);
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  void _reload() => setState(() { _future = _api.listLeave(widget.doctorId); });

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: now,
      lastDate: DateTime(now.year + 1),
    );
    if (picked != null) {
      setState(() => _date =
          '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}');
    }
  }

  Future<void> _mark({bool force = false}) async {
    if (_date == null) return;
    setState(() => _busy = true);
    try {
      await _api.markLeave(widget.doctorId, _date!, _reason.text.trim(), force);
      _reason.clear();
      setState(() => _date = null);
      _reload();
      if (mounted) showSuccessSnack(context, 'Leave marked');
    } on ApiException catch (e) {
      // Day has bookings: confirm with the doctor, then mark leave anyway.
      if (e.code == 'LEAVE_HAS_BOOKINGS' && !force) {
        final count = (e.details is List) ? (e.details as List).length : 0;
        if (mounted) setState(() => _busy = false);
        final ok = await _confirmLeaveWithBookings(count);
        if (ok == true && mounted) await _mark(force: true);
        return;
      }
      if (mounted) showErrorSnack(context, e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<bool?> _confirmLeaveWithBookings(int count) {
    final plural = count == 1 ? 'booking' : 'bookings';
    return showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Bookings on this day'),
        content: Text(
          count > 0
              ? 'This day already has $count confirmed $plural.\n\n'
                  'If you mark it as leave, those bookings stay booked — please '
                  'reschedule them to another day from the dashboard.\n\n'
                  'New patients will see this day as “On leave” and won’t be able '
                  'to book it.'
              : 'If you mark this day as leave, new patients will see it as '
                  '“On leave” and won’t be able to book it.',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(c, false),
              child: const Text('Cancel')),
          TextButton(
              onPressed: () => Navigator.pop(c, true),
              child: const Text('Mark leave')),
        ],
      ),
    );
  }

  Future<void> _remove(String date) async {
    try {
      await _api.removeLeave(widget.doctorId, date);
      _reload();
      if (mounted) showSuccessSnack(context, 'Leave removed');
    } on ApiException catch (e) {
      if (mounted) showErrorSnack(context, e.message);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const CardTitle('Leave days'),
          if (widget.canEdit) ...[
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _pickDate,
                    icon: const Icon(Icons.calendar_today_outlined, size: 16),
                    label: Text(_date ?? 'Pick date',
                        overflow: TextOverflow.ellipsis),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _reason,
              decoration: const InputDecoration(hintText: 'Reason (optional)'),
            ),
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: (_date == null || _busy) ? null : _mark,
                child: const Text('Mark this date as leave'),
              ),
            ),
            const SizedBox(height: 6),
            const Text(
                'If the day has bookings, you’ll be asked to confirm; existing '
                'bookings stay and should be rescheduled.',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          ],
          const Divider(height: 24),
          const Text('Scheduled leave',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
          const SizedBox(height: 8),
          FutureBuilder<List<LeaveDay>>(
            future: _future,
            builder: (context, snap) {
              if (snap.connectionState == ConnectionState.waiting) {
                return const Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: Text('Loading…',
                      style: TextStyle(color: AppColors.textSecondary)),
                );
              }
              final list = snap.data ?? [];
              if (list.isEmpty) {
                return const Text('No leave marked.',
                    style: TextStyle(color: AppColors.textSecondary));
              }
              return Column(
                children: list
                    .map((l) => Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(l.date),
                                    if (l.reason != null && l.reason!.isNotEmpty)
                                      Text(l.reason!,
                                          style: const TextStyle(
                                              color: AppColors.textSecondary,
                                              fontSize: 12)),
                                  ],
                                ),
                              ),
                              if (widget.canEdit)
                                TextButton(
                                  onPressed: () => _remove(l.date),
                                  style: TextButton.styleFrom(
                                      foregroundColor: AppColors.error),
                                  child: const Text('Remove'),
                                ),
                            ],
                          ),
                        ))
                    .toList(),
              );
            },
          ),
        ],
      ),
    );
  }
}

class _SlotPreview extends StatefulWidget {
  final String doctorId;
  const _SlotPreview({required this.doctorId});

  @override
  State<_SlotPreview> createState() => _SlotPreviewState();
}

class _SlotPreviewState extends State<_SlotPreview> {
  Future<DaySlots>? _future;
  String? _date;

  ApiClient get _api => AuthScope.of(context).api;

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: now,
      lastDate: DateTime(now.year + 1),
    );
    if (picked != null) {
      _date =
          '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
      setState(() { _future = _api.slots(widget.doctorId, _date!); });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const CardTitle('Preview slots'),
          OutlinedButton.icon(
            onPressed: _pickDate,
            icon: const Icon(Icons.calendar_today_outlined, size: 16),
            label: Text(_date ?? 'Pick a date'),
          ),
          const SizedBox(height: 12),
          if (_future == null)
            const Text('Pick a date to preview generated slots.',
                style: TextStyle(color: AppColors.textSecondary))
          else
            FutureBuilder<DaySlots>(
              future: _future,
              builder: (context, snap) {
                if (snap.connectionState == ConnectionState.waiting) {
                  return const Padding(
                    padding: EdgeInsets.all(8),
                    child: Center(
                        child: CircularProgressIndicator(strokeWidth: 2.2)),
                  );
                }
                if (snap.hasError) {
                  return const Text('Could not load slots.',
                      style: TextStyle(color: AppColors.textSecondary));
                }
                final d = snap.data!;
                if (!d.available) {
                  return Text('Not available (${d.unavailableLabel})',
                      style: const TextStyle(color: AppColors.textSecondary));
                }
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${d.slots.length} slots',
                        style: const TextStyle(
                            color: AppColors.textSecondary, fontSize: 12)),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: d.slots
                          .map((s) => _slotChip(s))
                          .toList(),
                    ),
                  ],
                );
              },
            ),
        ],
      ),
    );
  }

  Widget _slotChip(Slot s) {
    final (bg, fg) = switch (s.status) {
      SlotStatus.available => (AppColors.primaryTint, AppColors.primary),
      SlotStatus.booked => (const Color(0xFFEDEFF2), AppColors.textSecondary),
      SlotStatus.past => (const Color(0xFFF2F3F5), AppColors.booked),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(s.startTime,
          style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w500)),
    );
  }
}
