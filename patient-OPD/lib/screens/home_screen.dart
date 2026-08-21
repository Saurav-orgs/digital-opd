import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../api/api_client.dart';
import '../api/models.dart';
import '../config.dart';
import '../doctor_context.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'booking_form_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _api = ApiClient();

  Doctor? _doctor;
  bool _loading = false;
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
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final ctx = DoctorContextScope.of(context).doctor;
    if (ctx != null && (_doctor == null || _doctor!.id != ctx.id)) {
      _loadDoctorBySlug(ctx.slug);
    }
  }

  Future<void> _loadDoctorBySlug(String slug) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final d = await _api.doctorBySlug(slug);
      if (!mounted) return;
      setState(() {
        _doctor = d;
        _loading = false;
      });
      _loadSlots();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'Could not load doctor info.';
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
        child: _content(),
      ),
    );
  }

  Widget _content() {
    final ctx = DoctorContextScope.of(context).doctor;
    if (ctx == null) return _qrPrompt();
    if (_loading) return const StateView(loading: true);
    if (_error != null) {
      return StateView(
          error: _error, onRetry: () => _loadDoctorBySlug(ctx.slug));
    }
    if (_doctor == null) {
      return const StateView(empty: 'Could not load doctor info.');
    }

    return RefreshIndicator(
      onRefresh: () => _loadDoctorBySlug(ctx!.slug),
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          _doctorHero(_doctor!),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _dateStrip(),
                const SizedBox(height: 16),
                _slotsSection(),
                const SizedBox(height: 32),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ── Doctor hero (replaces the old header + doctor card) ───────

  Widget _doctorHero(Doctor d) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 22),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.primary, AppColors.primaryHover],
        ),
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(24)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Breadcrumb label
          Row(
            children: [
              const Icon(Icons.local_hospital_rounded,
                  color: Colors.white70, size: 13),
              const SizedBox(width: 5),
              Text(
                'OPD Appointment',
                style: TextStyle(
                    color: Colors.white.withValues(alpha: 0.70),
                    fontSize: 11,
                    letterSpacing: 0.3),
              ),
            ],
          ),
          const SizedBox(height: 14),
          // Doctor info row
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              NetworkAvatar(url: d.profilePhotoUrl, size: 66),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      d.name,
                      style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                          fontSize: 18,
                          height: 1.2),
                    ),
                    if (d.specialization != null) ...[
                      const SizedBox(height: 3),
                      Text(
                        d.specialization!,
                        style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.85),
                            fontSize: 13),
                      ),
                    ],
                    if (d.qualifications != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        d.qualifications!,
                        style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.62),
                            fontSize: 12),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          // Bio — 2 lines max, italic feel
          if (d.bio != null && d.bio!.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(
              d.bio!,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                  color: Colors.white.withValues(alpha: 0.70),
                  fontSize: 12,
                  height: 1.5),
            ),
          ],
        ],
      ),
    );
  }

  // ── Date strip ─────────────────────────────────────────────────

  Widget _dateStrip() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Pick a date',
          style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: AppColors.textSecondary,
              letterSpacing: 0.3),
        ),
        const SizedBox(height: 8),
        SizedBox(
          height: 68,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: _dates.length,
            separatorBuilder: (_, _) => const SizedBox(width: 6),
            itemBuilder: (_, i) {
              final d = _dates[i];
              final selected = _fmt(d) == _fmt(_selected);
              return GestureDetector(
                onTap: () {
                  setState(() => _selected = d);
                  _loadSlots();
                },
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 150),
                  width: 52,
                  decoration: BoxDecoration(
                    color: selected ? AppColors.primary : AppColors.card,
                    borderRadius: BorderRadius.circular(AppRadius.control),
                    border: Border.all(
                        color:
                            selected ? AppColors.primary : AppColors.border,
                        width: 0.5),
                    boxShadow: selected
                        ? [
                            BoxShadow(
                              color: AppColors.primary.withValues(alpha: 0.25),
                              blurRadius: 6,
                              offset: const Offset(0, 2),
                            )
                          ]
                        : null,
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        DateFormat('EEE').format(d),
                        style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w500,
                            color: selected
                                ? Colors.white70
                                : AppColors.textSecondary),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        DateFormat('d').format(d),
                        style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                            color:
                                selected ? Colors.white : AppColors.text),
                      ),
                      Text(
                        DateFormat('MMM').format(d),
                        style: TextStyle(
                            fontSize: 10,
                            color: selected
                                ? Colors.white70
                                : AppColors.textSecondary),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  // ── Slots section ──────────────────────────────────────────────

  Widget _slotsSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Label + legend on same row
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              'Available slots',
              style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary,
                  letterSpacing: 0.3),
            ),
            _legend(),
          ],
        ),
        const SizedBox(height: 10),
        _slots(),
      ],
    );
  }

  Widget _slots() {
    return FutureBuilder<DaySlots>(
      future: _slotsFuture,
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Padding(
            padding: EdgeInsets.symmetric(vertical: 20),
            child: Center(
                child: CircularProgressIndicator(strokeWidth: 2.4)),
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

        return Wrap(
          spacing: 8,
          runSpacing: 8,
          children: day.slots.map((s) => _slotChip(s)).toList(),
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
    return GestureDetector(
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
        child: Text(
          s.startTime,
          textAlign: TextAlign.center,
          style: TextStyle(
              color: fg, fontWeight: FontWeight.w600, fontSize: 13),
        ),
      ),
    );
  }

  Widget _legend() {
    Widget dot(Color c, String label) => Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
                width: 7,
                height: 7,
                decoration: BoxDecoration(
                    color: c, borderRadius: BorderRadius.circular(2))),
            const SizedBox(width: 4),
            Text(label,
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 11)),
          ],
        );
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        dot(AppColors.primary, 'Open'),
        const SizedBox(width: 10),
        dot(const Color(0xFFD3D1C7), 'Booked'),
        const SizedBox(width: 10),
        dot(const Color(0xFF9AA1AB), 'Past'),
      ],
    );
  }

  Widget _notice(String msg) {
    return SectionCard(
      child: Row(
        children: [
          const Icon(Icons.info_outline,
              color: AppColors.textSecondary, size: 18),
          const SizedBox(width: 10),
          Expanded(
              child: Text(msg,
                  style: const TextStyle(
                      color: AppColors.textSecondary, fontSize: 13))),
        ],
      ),
    );
  }

  Widget _qrPrompt() {
    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 80,
            height: 80,
            decoration: BoxDecoration(
              color: AppColors.primary,
              borderRadius: BorderRadius.circular(40),
            ),
            child: const Icon(Icons.qr_code_scanner,
                color: Colors.white, size: 40),
          ),
          const SizedBox(height: 24),
          const Text(
            'Scan your doctor\'s QR code',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 10),
          const Text(
            'Your doctor has a unique QR code for their OPD. Scan it to open their booking portal.',
            style: TextStyle(color: AppColors.textSecondary, height: 1.5),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          const SectionCard(
            child: Text(
              'Ask your doctor or the clinic reception for the QR link.',
              style:
                  TextStyle(color: AppColors.textSecondary, fontSize: 13),
              textAlign: TextAlign.center,
            ),
          ),
        ],
      ),
    );
  }
}
