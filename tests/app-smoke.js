import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

const prefix = GLib.getenv('DOSAGE_PREFIX');
imports.package.init({ name: 'dosage', version: '2.1.9', prefix,
	libdir: `${prefix}/lib`, datadir: `${prefix}/share` });
for (const kind of ['src', 'data']) {
	Gio.resources_register(Gio.Resource.load(`${prefix}/share/dosage/io.github.diegopvlk.Dosage.${kind}.gresource`));
}
const { DosageApplication } = await import('resource:///io/github/diegopvlk/Dosage/js/main.js');
const { treatmentsLS, historyLS } = await import('resource:///io/github/diegopvlk/Dosage/js/window.js');
const { MedDialog } = await import('resource:///io/github/diegopvlk/Dosage/js/medDialog.js');
const { PrefsDialog } = await import('resource:///io/github/diegopvlk/Dosage/js/prefsDialog.js');
const { OneTimeDialog } = await import('resource:///io/github/diegopvlk/Dosage/js/oneTimeDialog.js');
const { isValidTreatmentItem } = await import('resource:///io/github/diegopvlk/Dosage/js/utils/helpers.js');
const { programArgs } = await import('system');
const app = new DosageApplication();
const running = app.runAsync(['dosage-smoke-test']);
let failure;
setTimeout(async () => {
	try {
		const win = app.activeWindow;
		if (!win || win._spinnerToday.visible) throw new Error('Window did not finish loading');
		if (programArgs[0] === 'create') {
			if (treatmentsLS.n_items !== 0) throw new Error('Smoke test requires an isolated empty data directory');
			const preferences = new PrefsDialog();
			preferences.present(win);
			preferences.force_close();
			const oneTime = new OneTimeDialog();
			oneTime.present(win);
			oneTime.force_close();
			const dialog = new MedDialog();
			dialog.present(win);
			dialog._medName.text = 'macOS port smoke test';
			dialog._medUnit.text = 'test units';
			dialog._frequencyMenu.selected = 4; // As-needed: no live reminder.
			dialog._save();
			if (treatmentsLS.n_items !== 1) throw new Error('Treatment was not saved');
			if (!isValidTreatmentItem(treatmentsLS.get_item(0))) throw new Error('Invalid treatment');
			win._viewStack.visible_child_name = 'history-page';
			win._viewStack.visible_child_name = 'treatments-page';
			settings.set_int('window-width', 860);
			// Let the existing asynchronous JSON writer finish before quitting.
			await new Promise(resolve => setTimeout(resolve, 250));
			const [, bytes] = GLib.file_get_contents(`${GLib.get_user_data_dir()}/dosage-treatments.json`);
			if (JSON.parse(new TextDecoder().decode(bytes)).treatments.length !== 1)
				throw new Error('Treatment was not written to disk');
		} else {
			if (treatmentsLS.n_items !== 1 || treatmentsLS.get_item(0).obj.name !== 'macOS port smoke test')
				throw new Error('Treatment did not survive a restart');
			if (settings.get_int('window-width') !== 860) throw new Error('Settings did not survive a restart');
		}
		if (historyLS.n_items !== 0) throw new Error('Smoke test unexpectedly recorded a dose');
		print(`PASS: application ${programArgs[0]} (window, dialogs, treatment storage, settings)`);
	} catch (error) {
		failure = error;
	} finally {
		app.quit();
	}
}, 1500);
await running;
if (failure) throw failure;
