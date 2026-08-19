import 'dart:async';
import 'package:flutter/material.dart';
import '../api/models.dart';
import '../auth/auth_scope.dart';
import '../theme.dart';
import '../widgets/common.dart';
import 'appointments_screen.dart' show AppointmentDetailScreen;
import 'walkin_form_screen.dart';

/// Single-doctor hub: summary cards + Today / Upcoming / Previous appointments,
/// searchable, with a walk-in action. Replaces the standalone Appointments tab.
class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  final _searchController = TextEditingController();
  Timer? _debounce;
  String? _search;

  // Bumped to force the tab lists to reload (after a change, walk-in, etc.).
  int _reloadToken = 0;
  DashboardSummary? _summary;
  bool _summaryStarted = false;

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

  @override
  Widget build(BuildContext context) {
    final auth = AuthScope.of(context);
    final canCreate = auth.can('appointments', 'create');
    final firstName = (auth.user?.name ?? '').split(' ').first;

    return DefaultTabController(
      length: 3,
      initialIndex: 1, // Today (middle) selected by default.
      child: Scaffold(
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
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          firstName.isEmpty ? 'Appointments' : 'Hi, $firstName',
                          style: const TextStyle(
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
                  const SizedBox(height: 4),
                  _summaryCards(),
                  const SizedBox(height: 12),
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
                  const SizedBox(height: 4),
                  TabBar(
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
                children: [
                  _RangeAppointments(
                      range: 'previous',
                      search: _search,
                      reloadToken: _reloadToken,
                      onChanged: _reloadAll),
                  _RangeAppointments(
                      range: 'today',
                      search: _search,
                      reloadToken: _reloadToken,
                      onChanged: _reloadAll),
                  _RangeAppointments(
                      range: 'upcoming',
                      search: _search,
                      reloadToken: _reloadToken,
                      onChanged: _reloadAll),
                ],
              ),
            ),
          ],
        ),
      ),
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

  /// A grid of count cards — all visible at once (no scrolling).
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
          _StatCard(
              accent: AppColors.secondary,
              icon: Icons.check_circle_outline,
              value: d?.status('done'),
              label: "Today's Done"),
          _StatCard(
              accent: AppColors.onHold,
              icon: Icons.pause_circle_outline,
              value: d?.status('on_hold'),
              label: "Today's On Hold"),
          _StatCard(
              accent: AppColors.primary,
              icon: Icons.pending_outlined,
              value: d?.status('pending'),
              label: "Today's Pending"),
    ];
    return GridView.count(
      crossAxisCount: 3,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      padding: EdgeInsets.zero,
      mainAxisSpacing: 10,
      crossAxisSpacing: 10,
      childAspectRatio: 1.55,
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
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
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
              Icon(icon, size: 15, color: accent),
              const Spacer(),
              Text(value == null ? '—' : '$value',
                  style: const TextStyle(
                      fontSize: 20, fontWeight: FontWeight.w700)),
            ],
          ),
          const SizedBox(height: 2),
          Text(label,
              style: const TextStyle(
                  color: AppColors.textSecondary, fontSize: 12),
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
  final int reloadToken;

  /// Called after a change bubbles up from a detail screen so the parent can
  /// refresh the summary cards and every tab together.
  final VoidCallback onChanged;

  const _RangeAppointments({
    required this.range,
    required this.search,
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
        old.reloadToken != widget.reloadToken) {
      _reload();
    }
  }

  Future<List<Appointment>> _load() => AuthScope.of(context).api.listAppointments(
        range: widget.range,
        search: widget.search,
      );

  void _reload() => setState(() {
        _future = _load();
      });

  Future<void> _refresh() async {
    _reload();
    await _future;
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
        final list = snap.data ?? [];
        if (list.isEmpty) {
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(
              children: const [
                SizedBox(height: 120),
                StateView(empty: 'No appointments here.'),
              ],
            ),
          );
        }
        return RefreshIndicator(
          onRefresh: _refresh,
          child: ListView.separated(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
            itemCount: list.length,
            separatorBuilder: (_, _) => const SizedBox(height: 10),
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
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(a.patientName,
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
                Text('${a.appointmentDate} · ${a.startTime}',
                    style: const TextStyle(
                        color: AppColors.textSecondary, fontSize: 12)),
              ],
            ),
            const SizedBox(height: 4),
            Text(a.patientMobile,
                style: const TextStyle(
                    color: AppColors.textSecondary, fontSize: 13)),
            if (a.onLeave) ...[
              const SizedBox(height: 10),
              const _OnLeaveBanner(),
            ],
            const SizedBox(height: 10),
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
