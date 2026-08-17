// Smoke test: the app boots and shows the single-doctor booking home.
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:flutter_application_1/main.dart';

void main() {
  // AppConfig reads the bundled .env at construction; load a stub for tests.
  setUpAll(() => dotenv.testLoad(fileInput: 'API_BASE_URL=http://localhost/api'));

  testWidgets('App boots to the OPD booking home', (WidgetTester tester) async {
    await tester.pumpWidget(const OpdApp());
    await tester.pump();
    expect(find.text('Book your OPD'), findsOneWidget);
  });
}
