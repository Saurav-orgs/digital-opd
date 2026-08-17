import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../config.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'booking_form_screen.dart';

/// Single-doctor home: loads the clinic's doctor and shows the booking flow
/// (doctor info + date + slots) directly — no doctor list, no search.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _api = ApiClient();

  Doctor? _doctor;
  bool _loading = true;
  String? _error;

  late final List<DateTime> _dates;
  late DateTime _selected;
  Future<DaySlots>? _slotsFuture;

  @override
  void initState() {
    super.initState();
    final today = DateTime.now();
    _dates = List.generate(
      AppConfig.bookingWindowDays + 1,
      (i) => DateTime(today.year, today.month, today.day + i),
    );
    _selected = _dates.first;
    _loadDoctor();
  }

  Future<void> _loadDoctor() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final doctors = await _api.listDoctors();
      if (!mounted) return;
      setState(() {
        _doctor = doctors.isEmpty ? null : doctors.first;
        _loading = false;
      });
      if (_doctor != null) _loadSlots();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not load the clinic. Please try again.';
        _loading = false;
      });
    }
  }

  String _fmt(DateTime d) => DateFormat('yyyy-MM-dd').format(d);

  void _loadSlots() {
    final doc = _doctor;
    if (doc == null) return;
    setState(() {
      _slotsFuture = _api.slots(doc.id, _fmt(_selected));
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            _header(),
            Expanded(child: _content()),
          ],
        ),
      ),
    );
  }

  Widget _header() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(20, 20, 20, 20),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.primary, AppColors.primaryHover],
        ),
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(20)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.local_hospital_rounded, color: Colors.white, size: 22),
              SizedBox(width: 8),
              Text('OPD Appointments',
                  style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w500,
                      fontSize: 15)),
            ],
          ),
          const SizedBox(height: 16),
          const Text('Book your OPD',
              style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w500,
                  fontSize: 24)),
          const SizedBox(height: 4),
          Text('Pick a date and time that works for you',
              style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.85), fontSize: 14)),
        ],
      ),
    );
  }

  Widget _content() {
    if (_loading) return const StateView(loading: true);
    if (_error != null) return StateView(error: _error, onRetry: _loadDoctor);
    if (_doctor == null) {
      return const StateView(empty: 'No doctor is available right now.');
    }

    return RefreshIndicator(
      onRefresh: _loadDoctor,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _doctorCard(_doctor!),
          const SizedBox(height: 20),
          const Text('Select a date',
              style: TextStyle(fontWeight: FontWeight.w500)),
          const SizedBox(height: 10),
          _dateStrip(),
          const SizedBox(height: 20),
          const Text('Available slots',
              style: TextStyle(fontWeight: FontWeight.w500)),
          const SizedBox(height: 12),
          _slots(),
          const SizedBox(height: 24),
        ],
      ),
    );
  }

  Widget _doctorCard(Doctor d) {
    return SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              NetworkAvatar(url: d.profilePhotoUrl, size: 64),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(d.name,
                        style: const TextStyle(
                            fontWeight: FontWeight.w500, fontSize: 17)),
                    if (d.specialization != null)
                      Text(d.specialization!,
                          style:
                              const TextStyle(color: AppColors.textSecondary)),
                    if (d.qualifications != null)
                      Text(d.qualifications!,
                          style: const TextStyle(
                              color: AppColors.textSecondary, fontSize: 12)),
                  ],
                ),
              ),
              if (d.consultationFee != null)
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(d.feeLabel,
                        style: const TextStyle(
                            fontWeight: FontWeight.w500,
                            fontSize: 16,
                            color: AppColors.secondary)),
                    const Text('fee',
                        style: TextStyle(
                            color: AppColors.textSecondary, fontSize: 12)),
                  ],
                ),
            ],
          ),
          if (d.bio != null && d.bio!.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(d.bio!,
                style: const TextStyle(
                    color: AppColors.textSecondary, height: 1.4)),
          ],
        ],
      ),
    );
  }

  Widget _dateStrip() {
    return SizedBox(
      height: 74,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: _dates.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (_, i) {
          final d = _dates[i];
          final selected = _fmt(d) == _fmt(_selected);
          return InkWell(
            borderRadius: BorderRadius.circular(AppRadius.control),
            onTap: () {
              _selected = d;
              _loadSlots();
            },
            child: Container(
              width: 58,
              decoration: BoxDecoration(
                color: selected ? AppColors.primary : AppColors.card,
                borderRadius: BorderRadius.circular(AppRadius.control),
                border: Border.all(
                    color: selected ? AppColors.primary : AppColors.border,
                    width: 0.5),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(DateFormat('EEE').format(d),
                      style: TextStyle(
                          fontSize: 12,
                          color: selected
                              ? Colors.white70
                              : AppColors.textSecondary)),
                  const SizedBox(height: 4),
                  Text(DateFormat('d').format(d),
                      style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w500,
                          color: selected ? Colors.white : AppColors.text)),
                  Text(DateFormat('MMM').format(d),
                      style: TextStyle(
                          fontSize: 11,
                          color: selected
                              ? Colors.white70
                              : AppColors.textSecondary)),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _slots() {
    return FutureBuilder<DaySlots>(
      future: _slotsFuture,
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Padding(
            padding: EdgeInsets.all(24),
            child: Center(child: CircularProgressIndicator(strokeWidth: 2.4)),
          );
        }
        if (snap.hasError) {
          final msg = snap.error is ApiException
              ? (snap.error as ApiException).message
              : 'Could not load slots.';
          return _notice(msg);
        }
        final day = snap.data!;
        if (!day.available) return _notice(day.unavailableLabel);
        if (day.slots.isEmpty) return _notice('No slots for this day.');

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _legend(),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: day.slots.map((s) => _slotChip(s)).toList(),
            ),
          ],
        );
      },
    );
  }

  Widget _slotChip(Slot s) {
    late Color bg, fg, border;
    switch (s.status) {
      case SlotStatus.available:
        bg = AppColors.primaryTint;
        fg = AppColors.primary;
        border = AppColors.primaryTint;
        break;
      case SlotStatus.booked:
        bg = const Color(0xFFEEEDE8);
        fg = const Color(0xFF6B6A60);
        border = const Color(0xFFEEEDE8);
        break;
      case SlotStatus.past:
        bg = AppColors.page;
        fg = const Color(0xFF9AA1AB);
        border = AppColors.border;
        break;
    }
    return InkWell(
      borderRadius: BorderRadius.circular(AppRadius.control),
      onTap: s.selectable
          ? () async {
              await Navigator.push(
                context,
                MaterialPageRoute(
                  builder: (_) => BookingFormScreen(
                    doctor: _doctor!,
                    date: _fmt(_selected),
                    slot: s,
                  ),
                ),
              );
              // Refresh so a just-booked (or now-taken) slot reflects
              // immediately — whether the flow completed or was cancelled.
              if (mounted) _loadSlots();
            }
          : null,
      child: Container(
        width: 82,
        padding: const EdgeInsets.symmetric(vertical: 9),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(AppRadius.control),
          border: Border.all(color: border, width: 0.5),
        ),
        child: Text(s.startTime,
            textAlign: TextAlign.center,
            style:
                TextStyle(color: fg, fontWeight: FontWeight.w500, fontSize: 13)),
      ),
    );
  }

  Widget _legend() {
    Widget dot(Color c, String label) => Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
                width: 9,
                height: 9,
                decoration: BoxDecoration(
                    color: c, borderRadius: BorderRadius.circular(3))),
            const SizedBox(width: 5),
            Text(label,
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 12)),
          ],
        );
    return Wrap(spacing: 16, children: [
      dot(AppColors.primary, 'Available'),
      dot(const Color(0xFFD3D1C7), 'Booked'),
      dot(const Color(0xFF9AA1AB), 'Past'),
    ]);
  }

  Widget _notice(String msg) {
    return SectionCard(
      child: Row(
        children: [
          const Icon(Icons.info_outline, color: AppColors.textSecondary, size: 20),
          const SizedBox(width: 10),
          Expanded(
              child: Text(msg,
                  style: const TextStyle(color: AppColors.textSecondary))),
        ],
      ),
    );
  }
}
