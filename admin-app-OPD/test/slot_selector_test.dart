import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:opd_admin/api/api_client.dart';
import 'package:opd_admin/api/models.dart';
import 'package:opd_admin/widgets/slot_selector.dart';

class _FakeApi extends ApiClient {
  _FakeApi() : super(TokenStore());

  @override
  Future<DaySlots> slots(String doctorId, String date) async => DaySlots(
        date: date,
        available: true,
        slots: [
          Slot(startTime: '10:00', endTime: '10:10', status: SlotStatus.available),
        ],
      );
}

/// Mirrors the reschedule screen: its onChanged calls setState. If SlotSelector
/// emits its initial callback synchronously during build, this throws
/// "setState() called during build".
class _Host extends StatefulWidget {
  final ApiClient api;
  const _Host(this.api);
  @override
  State<_Host> createState() => _HostState();
}

class _HostState extends State<_Host> {
  String? _date;
  Slot? _slot;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        // Reading the fields here reflects the reschedule screen, whose confirm
        // button is enabled based on the selected date/slot.
        Text(_slot == null ? 'no-slot' : 'slot:${_slot!.startTime}@$_date'),
        SlotSelector(
          api: widget.api,
          doctorId: 'doc-1',
          onChanged: (date, slot) => setState(() {
            _date = date;
            _slot = slot;
          }),
        ),
      ],
    );
  }
}

void main() {
  setUpAll(() => dotenv.testLoad(fileInput: 'API_BASE_URL=http://localhost/api'));

  testWidgets('SlotSelector never setStates the parent during build',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(home: Scaffold(body: _Host(_FakeApi()))),
    );
    // Let the post-frame callback + the slots future resolve.
    await tester.pump();
    expect(tester.takeException(), isNull);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    // The slot chip renders and is selectable without error.
    expect(find.text('10:00'), findsOneWidget);
    await tester.tap(find.text('10:00'));
    await tester.pump();
    expect(tester.takeException(), isNull);
  });
}
