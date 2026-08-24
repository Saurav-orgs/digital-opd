import 'dart:async';
import 'package:flutter/material.dart';
import '../api/models.dart';
import '../auth/auth_scope.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'appointments_screen.dart' show AppointmentDetailScreen;
import 'walkin_form_screen.dart';

String _addDaysStr(DateTime base, int n) =>
    base.add(Duration(days: n)).toIso8601String().substring(0, 10);
final String _kToday = _addDaysStr(DateTime.now(), 0);
final String _kYesterday = _addDaysStr(DateTime.now(), -1);
final String _kTomorrow = _addDaysStr(DateTime.now(), 1);

/// Single-doctor hub: summary cards + Previous / Today / Upcoming appointments,
/// searchable and filterable by status, with a walk-in action.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen>
    with SingleTickerProviderStateMixin {
  final _searchController = TextEditingController();
  Timer? _debounce;
  String? _search;
  String? _date;
  // pending | done | all — pending is the default so staff see what still
  // needs attention first.
  String _status = 'pending';

  late final TabController _tabController;
  static const _ranges = ['previous', 'today', 'upcoming'];

  // Bumped to force the tab lists to reload (after a change, walk-in, etc.).
  int _reloadToken = 0;
  DashboardSummary? _summary;
  bool _summaryStarted = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this, initialIndex: 1);
    _tabController.addListener(() {
      if (_tabController.indexIsChanging) return;
      // A picked date only makes sense within the tab it was picked for.
      setState(() => _date = null);
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (!_summaryStarted) {
      _summaryStarted = true;
      _loadSummary();
    }
  }

  Future<void> _loadSummary() async {
    try {
      final s = await AuthScope.of(context).api.dashboard();
      if (mounted) setState(() => _summary = s);
    } catch (_) {/* cards/badges just stay blank on failure */}
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    _tabController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    setState(() {});
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      final q = value.trim();
      final next = q.isEmpty ? null : q;
      if (next != _search) setState(() => _search = next);
    });
  }

  /// Refresh the summary cards AND every tab list.
  void _reloadAll() {
    setState(() => _reloadToken++);
    _loadSummary();
  }

  Future<void> _addWalkIn() async {
    final booked = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => const WalkInFormScreen()),
    );
    if (booked == true) _reloadAll();
  }

  Future<void> _pickDate() async {
    final range = _ranges[_tabController.index];
    final isPrevious = range == 'previous';
    final first = isPrevious ? DateTime(2020, 1, 1) : DateTime.parse(_kTomorrow);
    final last = isPrevious
        ? DateTime.parse(_kYesterday)
        : DateTime(2100, 12, 31);
    final initial = _date != null
        ? DateTime.parse(_date!)
        : (isPrevious ? DateTime.parse(_kYesterday) : DateTime.parse(_kTomorrow));
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: first,
      lastDate: last,
    );
    if (picked != null) {
      setState(() => _date = picked.toIso8601String().substring(0, 10));
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = AuthScope.of(context);
    final canCreate = auth.can('appointments', 'create');
    final currentRange = _ranges[_tabController.index];

    return Scaffold(
      backgroundColor: AppColors.page,
      floatingActionButton: canCreate
          ? FloatingActionButton.extended(
              onPressed: _addWalkIn,
              icon: const Icon(Icons.add),
              label: const Text('Walk-in'),
            )
          : null,
      body: Column(
        children: [
          Container(
            color: AppColors.card,
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
            child: Column(
              children: [
                Row(
                  children: [
                    const Expanded(
                      child: Text(
                        'Appointments',
                        style: TextStyle(
                            fontSize: 18, fontWeight: FontWeight.w600),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Refresh',
                      icon: const Icon(Icons.refresh),
                      onPressed: _reloadAll,
                    ),
                  ],
                ),
                _summaryCards(),
                const SizedBox(height: 8),
                TextField(
                  controller: _searchController,
                  onChanged: _onSearchChanged,
                  textInputAction: TextInputAction.search,
                  decoration: InputDecoration(
                    hintText: 'Search name or phone…',
                    prefixIcon: const Icon(Icons.search, size: 20),
                    isDense: true,
                    suffixIcon: _searchController.text.isEmpty
                        ? null
                        : IconButton(
                            icon: const Icon(Icons.close, size: 18),
                            onPressed: () {
                              _debounce?.cancel();
                              _searchController.clear();
                              setState(() => _search = null);
                            },
                          ),
                  ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(child: _dateFilterChip(currentRange)),
                    const SizedBox(width: 8),
                    _statusFilter(),
                  ],
                ),
                const SizedBox(height: 4),
                TabBar(
                  controller: _tabController,
                  onTap: (_) => setState(() {}),
                  tabs: [
                    _tab('Previous', _summary?.pendingPrevious),
                    _tab('Today', _summary?.pendingToday),
                    _tab('Upcoming', _summary?.pendingUpcoming),
                  ],
                ),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                _RangeAppointments(
                    range: 'previous',
                    search: _search,
                    date: currentRange == 'previous' ? _date : null,
                    status: _status,
                    reloadToken: _reloadToken,
                    onChanged: _reloadAll),
                _RangeAppointments(
                    range: 'today',
                    search: _search,
                    date: null,
                    status: _status,
                    reloadToken: _reloadToken,
                    onChanged: _reloadAll),
                _RangeAppointments(
                    range: 'upcoming',
                    search: _search,
                    date: currentRange == 'upcoming' ? _date : null,
                    status: _status,
                    reloadToken: _reloadToken,
                    onChanged: _reloadAll),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Always visible: fixed to today's date on the Today tab, otherwise narrows
  /// that tab's list to one specific day (bounded to past/future).
  Widget _dateFilterChip(String range) {
    final isToday = range == 'today';
    final label = isToday
        ? _kToday
        : (_date ?? (range == 'previous' ? 'Pick a past date' : 'Pick a date'));
    final color = isToday ? AppColors.textSecondary : AppColors.text;
    return InkWell(
      onTap: isToday ? null : _pickDate,
      borderRadius: BorderRadius.circular(AppRadius.control),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
        decoration: BoxDecoration(
          border: Border.all(color: AppColors.border),
          borderRadius: BorderRadius.circular(AppRadius.control),
          color: isToday ? AppColors.page : null,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.event_outlined, size: 16, color: AppColors.textSecondary),
            const SizedBox(width: 6),
            Flexible(
              child: Text(label,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 13, color: color)),
            ),
            if (!isToday && _date != null) ...[
              const SizedBox(width: 4),
              InkWell(
                onTap: () => setState(() => _date = null),
                child: const Icon(Icons.close, size: 15, color: AppColors.textSecondary),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _statusFilter() {
    return SegmentedButton<String>(
      segments: const [
        ButtonSegment(value: 'pending', label: Text('Pending')),
        ButtonSegment(value: 'done', label: Text('Done')),
        ButtonSegment(value: 'all', label: Text('All')),
      ],
      selected: {_status},
      showSelectedIcon: false,
      style: const ButtonStyle(
        visualDensity: VisualDensity.compact,
        textStyle: WidgetStatePropertyAll(TextStyle(fontSize: 12)),
      ),
      onSelectionChanged: (s) => setState(() => _status = s.first),
    );
  }

  /// A tab label with a small pending-count badge.
  Widget _tab(String label, int? pending) {
    return Tab(
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label),
          if (pending != null && pending > 0) ...[
            const SizedBox(width: 6),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
              decoration: BoxDecoration(
                color: AppColors.onHoldTint,
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text('$pending',
                  style: const TextStyle(
                      color: AppColors.onHold,
                      fontSize: 11,
                      fontWeight: FontWeight.w700)),
            ),
          ],
        ],
      ),
    );
  }

  /// A compact row of count cards — Today, Upcoming, and Previous.
  Widget _summaryCards() {
    final d = _summary;
    final cards = <Widget>[
      _StatCard(
          accent: AppColors.primary,
          icon: Icons.today_outlined,
          value: d?.total,
          label: 'Today'),
      _StatCard(
          accent: AppColors.booked,
          icon: Icons.event_outlined,
          value: d?.upcoming,
          label: 'Upcoming'),
      _StatCard(
          accent: AppColors.textSecondary,
          icon: Icons.history,
          value: d?.previous,
          label: 'Previous'),
    ];
    return GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      padding: EdgeInsets.zero,
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      childAspectRatio: 1.9,
      children: cards,
    );
  }
}

class _StatCard extends StatelessWidget {
  final Color accent;
  final IconData icon;
  final int? value; // null while loading
  final String label;
  const _StatCard({
    required this.accent,
    required this.icon,
    required this.value,
    required this.label,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.page,
        borderRadius: BorderRadius.circular(AppRadius.card),
        border: Border.all(color: AppColors.border, width: 0.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Row(
            children: [
              Icon(icon, size: 14, color: accent),
              const Spacer(),
              Text(value == null ? '—' : '$value',
                  style: const TextStyle(
                      fontSize: 18, fontWeight: FontWeight.w700)),
            ],
          ),
          Text(label,
              style: const TextStyle(
                  color: AppColors.textSecondary, fontSize: 11),
              maxLines: 1,
              overflow: TextOverflow.ellipsis),
        ],
      ),
    );
  }
}

/// A searchable, refreshable appointment list for one relative window.
class _RangeAppointments extends StatefulWidget {
  final String range;
  final String? search;
  final String? date;
  final String status; // pending | done | all

  final int reloadToken;

  /// Called after a change bubbles up from a detail screen so the parent can
  /// refresh the summary cards and every tab together.
  final VoidCallback onChanged;

  const _RangeAppointments({
    required this.range,
    required this.search,
    required this.date,
    required this.status,
    required this.reloadToken,
    required this.onChanged,
  });

  @override
  State<_RangeAppointments> createState() => _RangeAppointmentsState();
}

class _RangeAppointmentsState extends State<_RangeAppointments>
    with AutomaticKeepAliveClientMixin {
  Future<List<Appointment>>? _future;

  @override
  bool get wantKeepAlive => true;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future ??= _load();
  }

  @override
  void didUpdateWidget(covariant _RangeAppointments old) {
    super.didUpdateWidget(old);
    if (old.search != widget.search ||
        old.date != widget.date ||
        old.reloadToken != widget.reloadToken) {
      _reload();
    }
  }

  Future<List<Appointment>> _load() => AuthScope.of(context).api.listAppointments(
        range: widget.range,
        search: widget.search,
        date: widget.date,
      );

  void _reload() => setState(() {
        _future = _load();
      });

  Future<void> _refresh() async {
    _reload();
    await _future;
  }

  List<Appointment> _applyStatus(List<Appointment> rows) {
    if (widget.status == 'all') return rows;
    if (widget.status == 'done') {
      return rows.where((a) => a.consultationStatus == 'done').toList();
    }
    return rows.where((a) => a.consultationStatus != 'done').toList();
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    return FutureBuilder<List<Appointment>>(
      future: _future,
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const StateView(loading: true);
        }
        if (snap.hasError) {
          return StateView(
              error: 'Could not load appointments.', onRetry: _refresh);
        }
        final all = snap.data ?? [];
        final list = _applyStatus(all);
        if (list.isEmpty) {
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(
              children: [
                const SizedBox(height: 120),
                StateView(
                    empty: all.isEmpty
                        ? 'No appointments here.'
                        : 'No ${widget.status} appointments here.'),
              ],
            ),
          );
        }
        return RefreshIndicator(
          onRefresh: _refresh,
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 88),
            itemCount: list.length,
            separatorBuilder: (_, _) => const SizedBox(height: 8),
            itemBuilder: (context, i) =>
                _ApptCard(list[i], onChanged: widget.onChanged),
          ),
        );
      },
    );
  }
}

class _ApptCard extends StatelessWidget {
  final Appointment a;
  final VoidCallback onChanged;
  const _ApptCard(this.a, {required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final ageGender = [
      if (a.patientAge != null) '${a.patientAge}y',
      if (a.patientGender != null && a.patientGender!.isNotEmpty) a.patientGender,
    ].join(' · ');

    return InkWell(
      borderRadius: BorderRadius.circular(AppRadius.card),
      onTap: () async {
        final changed = await Navigator.push<bool>(
          context,
          MaterialPageRoute(builder: (_) => AppointmentDetailScreen(id: a.id)),
        );
        if (changed == true) onChanged();
      },
      child: SectionCard(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(a.patientName,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                      overflow: TextOverflow.ellipsis),
                ),
                Text('${a.appointmentDate} · ${a.startTime}',
                    style: const TextStyle(
                        color: AppColors.textSecondary, fontSize: 12)),
              ],
            ),
            const SizedBox(height: 3),
            Row(
              children: [
                const Icon(Icons.call_outlined, size: 13, color: AppColors.textSecondary),
                const SizedBox(width: 4),
                Text(a.patientMobile,
                    style: const TextStyle(
                        color: AppColors.textSecondary, fontSize: 13)),
                if (ageGender.isNotEmpty) ...[
                  const SizedBox(width: 12),
                  const Icon(Icons.person_outline, size: 13, color: AppColors.textSecondary),
                  const SizedBox(width: 4),
                  Text(ageGender,
                      style: const TextStyle(
                          color: AppColors.textSecondary, fontSize: 13)),
                ],
              ],
            ),
            if (a.onLeave) ...[
              const SizedBox(height: 8),
              const _OnLeaveBanner(),
            ],
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                if (a.isWalkIn) const StatusBadge('walk_in', label: 'Walk-in'),
                StatusBadge(a.consultationStatus),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Amber callout on a booking whose day was later marked as leave.
class _OnLeaveBanner extends StatelessWidget {
  const _OnLeaveBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.onHoldTint,
        borderRadius: BorderRadius.circular(AppRadius.control),
        border: Border.all(color: AppColors.onHold.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          const Icon(Icons.event_busy, size: 16, color: AppColors.onHold),
          const SizedBox(width: 8),
          const Expanded(
            child: Text(
              'Doctor is on leave this day — reschedule this booking.',
              style: TextStyle(
                  color: AppColors.onHold,
                  fontSize: 12,
                  fontWeight: FontWeight.w500),
            ),
          ),
        ],
      ),
    );
  }
}
