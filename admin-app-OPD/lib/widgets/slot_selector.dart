import 'package:flutter/material.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../theme.dart';
import 'common.dart';

/// Pick a date within the booking window and an available slot for a doctor.
/// Reused by the walk-in booking form and the reschedule flow.
class SlotSelector extends StatefulWidget {
  final ApiClient api;
  final String doctorId;

  /// Whether an in-progress ("past") slot may be selected. Walk-ins allow it.
  final bool allowPast;

  /// Emits the chosen date + slot (all null while nothing is selected).
  final void Function(String? date, Slot? slot) onChanged;

  const SlotSelector({
    super.key,
    required this.api,
    required this.doctorId,
    required this.onChanged,
    this.allowPast = false,
  });

  @override
  State<SlotSelector> createState() => _SlotSelectorState();
}

class _SlotSelectorState extends State<SlotSelector> {
  static const _windowDays = 7;

  late String _date;
  Future<DaySlots>? _future;
  Slot? _selected;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _date = _fmt(now);
    // Kick off the first load without setState (we're in initState) and defer
    // the parent callback to after the frame so it can't setState during build.
    _future = widget.api.slots(widget.doctorId, _date);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) widget.onChanged(_date, null);
    });
  }

  static String _fmt(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  // Called from user interaction (date picker) — safe to setState + notify now.
  void _load() {
    setState(() {
      _selected = null;
      _future = widget.api.slots(widget.doctorId, _date);
    });
    widget.onChanged(_date, null);
  }

  bool _selectable(Slot s) =>
      s.status == SlotStatus.available ||
      (widget.allowPast && s.status == SlotStatus.past);

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final current = DateTime.parse(_date);
    final picked = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: DateTime(now.year, now.month, now.day),
      lastDate: now.add(const Duration(days: _windowDays)),
    );
    if (picked != null) {
      _date = _fmt(picked);
      _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        OutlinedButton.icon(
          onPressed: _pickDate,
          icon: const Icon(Icons.calendar_today_outlined, size: 16),
          label: Text(_date),
        ),
        const SizedBox(height: 12),
        FutureBuilder<DaySlots>(
          future: _future,
          builder: (context, snap) {
            if (snap.connectionState == ConnectionState.waiting) {
              return const Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: StateView(loading: true),
              );
            }
            if (snap.hasError) {
              return const Text('Could not load slots.',
                  style: TextStyle(color: AppColors.textSecondary));
            }
            final day = snap.data!;
            if (!day.available) {
              return Text(day.unavailableLabel,
                  style: const TextStyle(color: AppColors.textSecondary));
            }
            final slots = day.slots.where(_selectable).toList();
            if (slots.isEmpty) {
              return const Text('No free slots on this day.',
                  style: TextStyle(color: AppColors.textSecondary));
            }
            return Wrap(
              spacing: 8,
              runSpacing: 8,
              children: slots.map((s) {
                final isSel = _selected?.startTime == s.startTime;
                return ChoiceChip(
                  label: Text(s.startTime),
                  selected: isSel,
                  onSelected: (_) {
                    setState(() => _selected = s);
                    widget.onChanged(_date, s);
                  },
                );
              }).toList(),
            );
          },
        ),
      ],
    );
  }
}
