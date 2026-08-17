import 'package:flutter/material.dart';
import '../auth/patient_scope.dart';
import '../theme.dart';
import 'home_screen.dart';
import 'login_screen.dart';
import 'my_visits_screen.dart';
import 'reports_screen.dart';
import 'notifications_screen.dart';

/// Bottom-nav shell: Book (public) + Visits / Reports / Notifications (need
/// a patient session — gated inline with a login prompt, not a route guard,
/// so booking is always reachable without signing in).
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;
  int _unread = 0;
  PatientAuthController? _auth;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final auth = PatientAuthScope.of(context);
    if (!identical(auth, _auth)) {
      _auth?.removeListener(_onAuthChanged);
      _auth = auth;
      _auth!.addListener(_onAuthChanged);
      _refreshUnread();
    }
  }

  @override
  void dispose() {
    _auth?.removeListener(_onAuthChanged);
    super.dispose();
  }

  void _onAuthChanged() => _refreshUnread();

  Future<void> _refreshUnread() async {
    final auth = PatientAuthScope.of(context);
    if (!auth.isAuthenticated) {
      if (mounted) setState(() => _unread = 0);
      return;
    }
    try {
      final count = await auth.api.unreadCount();
      if (mounted) setState(() => _unread = count);
    } catch (_) {/* badge just stays stale on failure */}
  }

  @override
  Widget build(BuildContext context) {
    final auth = PatientAuthScope.of(context);
    final tabs = [
      const HomeScreen(),
      auth.isAuthenticated
          ? const MyVisitsScreen()
          : const LoginPrompt(message: 'Login to see your consultation history.'),
      auth.isAuthenticated
          ? const ReportsScreen()
          : const LoginPrompt(message: 'Login to see your lab reports.'),
      auth.isAuthenticated
          ? NotificationsScreen(onChanged: _refreshUnread)
          : const LoginPrompt(message: 'Login to see your notifications.'),
    ];

    return Scaffold(
      body: IndexedStack(index: _index, children: tabs),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) {
          setState(() => _index = i);
          if (i == 3) _refreshUnread();
        },
        destinations: [
          const NavigationDestination(icon: Icon(Icons.event_available_outlined), label: 'Book'),
          const NavigationDestination(icon: Icon(Icons.history), label: 'Visits'),
          const NavigationDestination(icon: Icon(Icons.description_outlined), label: 'Reports'),
          NavigationDestination(
            icon: Badge(
              isLabelVisible: _unread > 0,
              label: Text('$_unread'),
              backgroundColor: AppColors.error,
              child: const Icon(Icons.notifications_outlined),
            ),
            label: 'Alerts',
          ),
        ],
      ),
    );
  }
}
