import 'package:flutter/material.dart';
import '../auth/auth_scope.dart';
import '../theme.dart';
import 'dashboard_screen.dart';
import 'pathlabs_screen.dart';
import 'profile_screen.dart';
import 'reports_screen.dart';
import 'roles_screen.dart';
import 'users_screen.dart';

class _Destination {
  final String label;
  final IconData icon;
  final String module;
  final Widget screen;
  const _Destination(this.label, this.icon, this.module, this.screen);
}

class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  List<_Destination> _destinations(AuthController auth) {
    final all = <_Destination>[
      const _Destination(
          'Dashboard', Icons.dashboard_outlined, 'dashboard', DashboardScreen()),
      // Appointments are now managed from the Dashboard tabs (single-doctor
      // setup), so the standalone Appointments section is intentionally hidden.
      // There is no separate "Doctor Profile" section: the SuperAdmin is the
      // clinic's one doctor and edits everything (profile + schedule) from the
      // "My profile" entry added below.
      const _Destination(
          'Pathlabs', Icons.biotech_outlined, 'pathlabs', PathlabsScreen()),
      const _Destination(
          'Reports', Icons.description_outlined, 'reports', ReportsScreen()),
      const _Destination(
          'Users', Icons.people_alt_outlined, 'users', UsersScreen()),
      const _Destination(
          'Roles', Icons.vpn_key_outlined, 'roles', RolesScreen()),
    ];
    final visible =
        all.where((d) => auth.can(d.module, 'read')).toList();
    // Doctor accounts get a self-service profile page.
    if (auth.user?.isDoctor ?? false) {
      visible.add(const _Destination(
          'My profile', Icons.person_outline, '__profile', ProfileScreen()));
    }
    return visible;
  }

  @override
  Widget build(BuildContext context) {
    final auth = AuthScope.of(context);
    final destinations = _destinations(auth);

    if (destinations.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: const Text('OPD Admin'), actions: [_logoutAction(auth)]),
        body: const Center(
          child: Padding(
            padding: EdgeInsets.all(28),
            child: Text(
              'Your account has no accessible sections. Contact an administrator.',
              textAlign: TextAlign.center,
              style: TextStyle(color: AppColors.textSecondary),
            ),
          ),
        ),
      );
    }

    final index = _index.clamp(0, destinations.length - 1);
    final current = destinations[index];

    return Scaffold(
      appBar: AppBar(
        title: Text(current.label),
        actions: [_logoutAction(auth)],
      ),
      drawer: _Drawer(
        destinations: destinations,
        selectedIndex: index,
        user: auth.user,
        onSelect: (i) {
          setState(() => _index = i);
          Navigator.pop(context);
        },
      ),
      body: IndexedStack(
        index: index,
        children: destinations.map((d) => d.screen).toList(),
      ),
    );
  }

  Widget _logoutAction(AuthController auth) => IconButton(
        tooltip: 'Sign out',
        icon: const Icon(Icons.logout),
        onPressed: () async {
          final ok = await showDialog<bool>(
            context: context,
            builder: (c) => AlertDialog(
              title: const Text('Sign out?'),
              content: const Text('You will need to sign in again.'),
              actions: [
                TextButton(
                    onPressed: () => Navigator.pop(c, false),
                    child: const Text('Cancel')),
                TextButton(
                    onPressed: () => Navigator.pop(c, true),
                    child: const Text('Sign out')),
              ],
            ),
          );
          if (ok == true) await auth.logout();
        },
      );
}

class _Drawer extends StatelessWidget {
  final List<_Destination> destinations;
  final int selectedIndex;
  final dynamic user;
  final ValueChanged<int> onSelect;
  const _Drawer({
    required this.destinations,
    required this.selectedIndex,
    required this.user,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    return Drawer(
      backgroundColor: AppColors.card,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: AppColors.primary,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(Icons.add, color: Colors.white),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(user?.name ?? 'OPD Admin',
                            style: const TextStyle(
                                fontWeight: FontWeight.w600, fontSize: 15),
                            overflow: TextOverflow.ellipsis),
                        Text(
                          (user?.type ?? '')
                              .toString()
                              .replaceAll('_', ' '),
                          style: const TextStyle(
                              color: AppColors.textSecondary, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.symmetric(vertical: 8),
                itemCount: destinations.length,
                itemBuilder: (context, i) {
                  final d = destinations[i];
                  final selected = i == selectedIndex;
                  return ListTile(
                    leading: Icon(d.icon,
                        color: selected
                            ? AppColors.primary
                            : AppColors.textSecondary),
                    title: Text(d.label,
                        style: TextStyle(
                          fontWeight:
                              selected ? FontWeight.w600 : FontWeight.w400,
                          color: selected ? AppColors.primary : AppColors.text,
                        )),
                    selected: selected,
                    selectedTileColor: AppColors.primaryTint,
                    shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8)),
                    onTap: () => onSelect(i),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
