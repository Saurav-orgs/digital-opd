import 'package:flutter/material.dart';
import '../api/models.dart';
import '../auth/patient_scope.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// Updates about reports and upcoming visits. Tapping an unread item marks
/// it read; the shell's badge count refreshes on return.
class NotificationsScreen extends StatefulWidget {
  final VoidCallback? onChanged;
  const NotificationsScreen({super.key, this.onChanged});

  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  Future<List<PatientNotification>>? _future;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future ??= PatientAuthScope.of(context).api.notifications();
  }

  Future<void> _refresh() async {
    setState(() => _future = PatientAuthScope.of(context).api.notifications());
    await _future;
    widget.onChanged?.call();
  }

  Future<void> _markRead(PatientNotification n) async {
    if (!n.isUnread) return;
    await PatientAuthScope.of(context).api.markNotificationRead(n.id);
    if (mounted) await _refresh();
  }

  Future<void> _markAllRead() async {
    await PatientAuthScope.of(context).api.markAllNotificationsRead();
    if (mounted) await _refresh();
  }

  IconData _iconFor(String type) => switch (type) {
        'report_available' => Icons.description_outlined,
        'appointment_reminder' => Icons.event_repeat,
        _ => Icons.notifications_outlined,
      };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          TextButton(onPressed: _markAllRead, child: const Text('Mark all read')),
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () => confirmSignOut(context, () => PatientAuthScope.of(context).logout()),
          ),
        ],
      ),
      body: FutureBuilder<List<PatientNotification>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const StateView(loading: true);
          }
          if (snap.hasError) {
            return StateView(error: 'Could not load notifications.', onRetry: _refresh);
          }
          final items = snap.data ?? [];
          if (items.isEmpty) {
            return RefreshIndicator(
              onRefresh: _refresh,
              child: ListView(children: const [
                SizedBox(height: 140),
                StateView(empty: 'No notifications yet.'),
              ]),
            );
          }
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: items.length,
              separatorBuilder: (_, _) => const SizedBox(height: 10),
              itemBuilder: (context, i) {
                final n = items[i];
                return InkWell(
                  onTap: () => _markRead(n),
                  borderRadius: BorderRadius.circular(AppRadius.card),
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: n.isUnread ? AppColors.primaryTint : AppColors.card,
                      borderRadius: BorderRadius.circular(AppRadius.card),
                      border: Border.all(color: AppColors.border, width: 0.5),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(_iconFor(n.type), color: AppColors.primary, size: 20),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(n.title, style: const TextStyle(fontWeight: FontWeight.w600)),
                              if (n.body != null && n.body!.isNotEmpty) ...[
                                const SizedBox(height: 2),
                                Text(n.body!, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
                              ],
                              const SizedBox(height: 6),
                              Text(n.createdAt.split('T').first,
                                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 11)),
                            ],
                          ),
                        ),
                        if (n.isUnread)
                          Container(
                            width: 8,
                            height: 8,
                            margin: const EdgeInsets.only(top: 4),
                            decoration: const BoxDecoration(color: AppColors.primary, shape: BoxShape.circle),
                          ),
                      ],
                    ),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}
