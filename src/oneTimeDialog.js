'use strict';

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { getDosageWindow } from './main.js';
import { MedicationObject } from './medication.js';
import TimePicker from './timePicker.js';
import { handleCalendarSelect } from './utils/helpers.js';
import { historyLS, treatmentsLS } from './window.js';

export const OneTimeDialog = GObject.registerClass(
	{
		GTypeName: 'OneTimeDialog',
		Template: 'resource:///io/github/diegopvlk/Dosage/ui/one-time-dialog.ui',
		InternalChildren: [
			'toastOverlay',
			'oneTimeDialogClamp',
			'medName',
			'colorBox',
			'colorButton',
			'colorPopover',
			'medUnit',
			'medAmount',
			'medTime',
			'dateOneEntry',
			'calOneEntry',
			'oneTimePopover',
			'confirmBtn',
			'oneTimeBtnRow',
			'oneTimeEntries',
			'popoverScrollTime',
		],
	},
	class OneTimeDialog extends Adw.Dialog {
		constructor() {
			super({});
			this._toast = new Adw.Toast();
			this._timePicker = new TimePicker();
			this._popoverScrollTime.set_child(this._timePicker);
			this._initOneTimeDialog();
			this._setTreatmentsBtnList();
		}

		_initOneTimeDialog() {
			const dosageWindow = getDosageWindow();
			const calendarDate = GLib.DateTime.new_now_local();
			const calDate = calendarDate.format('%x');

			for (const clr of this._colorBox) {
				clr.connect('clicked', () => {
					const cssClasses = [clr.get_name() + '-clr', 'circular'];
					this._colorButton.set_css_classes(cssClasses);
					this._colorButton.name = clr.get_name();
					this._colorPopover.popdown();
				});
			}

			this._dateOneEntry.subtitle = calDate;
			handleCalendarSelect(this._calOneEntry, this._dateOneEntry, true);

			this._medTime.subtitle = this._timePicker.entry.text;

			this._timePicker.entry.connect('changed', e => {
				this._medTime.subtitle = e.text;
			});

			this._confirmBtn.connect('clicked', () => {
				if (!this._isValidInput()) return;
				this._addSingleItemToHistory();
				dosageWindow.updateEverything({ skipCycleUp: true });
				this.force_close();
				dosageWindow.scheduleNotifications('saving');
			});

			const [oneTimeDialogClampHeight] = this._oneTimeDialogClamp.measure(
				Gtk.Orientation.VERTICAL,
				-1,
			);
			this.content_height = oneTimeDialogClampHeight + 58;
			this.present(dosageWindow);

			const setConfirmBtn = () => {
				if (this._medName.text.trim() == '' || this._medUnit.text.trim() == '') {
					this._confirmBtn.sensitive = false;
				} else {
					this._confirmBtn.sensitive = true;
				}
			};

			this._medName.connect('changed', name => {
				name.remove_css_class('error');
				setConfirmBtn();
				this._toast.dismiss();
			});
			this._medUnit.connect('changed', unit => {
				unit.remove_css_class('error');
				setConfirmBtn();
				this._toast.dismiss();
			});
		}

		_setTreatmentsBtnList() {
			const btnNew = new Gtk.Button({
				css_classes: ['flat'],
				can_shrink: true,
				label: _('New'),
			});

			btnNew.remove_css_class('text-button');
			btnNew.get_first_child().set_halign(Gtk.Align.START);
			btnNew.get_first_child().set_max_width_chars(50);
			this._oneTimeEntries.append(btnNew);

			btnNew.connect('clicked', () => {
				this._oneTimePopover.popdown();
				this._medName.text = '';
				this._medUnit.text = _('Pill(s)');
				this._colorButton.set_css_classes(['circular']);
				this._colorButton.name = 'default';
				this._medAmount.value = 1;
				this._medName.sensitive = true;
				this._medUnit.sensitive = true;
				this._existingEntry = false;
				this._toast.dismiss();
			});

			this._oneTimeBtnRow.get_child().append(this._oneTimePopover);
			this._oneTimeBtnRow.connect('activated', _ => this._oneTimePopover.popup());

			this._existingEntry = false;

			if (getDosageWindow()._treatmentsList.model.get_n_items() > 0) {
				this._oneTimeBtnRow.sensitive = true;

				const tempTreatmentsLS = Gio.ListStore.new(MedicationObject);

				for (const it of treatmentsLS) {
					tempTreatmentsLS.insert_sorted(it, (a, b) => {
						return a.obj.name.localeCompare(b.obj.name);
					});
				}

				for (const it of tempTreatmentsLS) {
					const item = it.obj;
					const btn = new Gtk.Button({
						css_classes: ['flat', 'one-time-name'],
						can_shrink: true,
						label: item.name,
						width_request: 120,
					});

					btn.get_first_child().set_max_width_chars(50);
					btn.remove_css_class('text-button');
					btn.get_first_child().set_halign(Gtk.Align.START);

					btn.connect('clicked', () => {
						const cssClasses = [item.color + '-clr', 'circular'];
						this._colorButton.set_css_classes(cssClasses);
						this._oneTimePopover.popdown();

						this._medName.text = item.name;
						this._medUnit.text = item.unit;
						this._colorButton.name = item.color;
						this._medAmount.value = item.dosage[0].dose;

						this._medName.sensitive = false;
						this._medUnit.sensitive = false;
						this._confirmBtn.sensitive = true;
						this._existingEntry = true;
						this._toast.dismiss();
					});
					this._oneTimeEntries.append(btn);
				}
			}
		}

		_isValidInput() {
			if (this._existingEntry) return true;

			for (const it of treatmentsLS) {
				const i = it.obj;
				if (i.name.toLowerCase() === this._medName.text.trim().toLowerCase()) {
					this._toast.title = _('Name Already on Treatment List');
					this._toastOverlay.add_toast(this._toast);
					this._medName.add_css_class('error');
					return;
				}
			}

			return true;
		}

		_addSingleItemToHistory() {
			const dt = +this._calOneEntry.get_date().format('%s') * 1000;
			const entryDate = new Date(dt);
			const dose = this._medAmount.value;
			const h = this._timePicker.hours;
			const m = this._timePicker.minutes;

			entryDate.setHours(this._timePicker.hours);
			entryDate.setMinutes(this._timePicker.minutes);
			entryDate.setSeconds(new Date().getSeconds());

			const item = new MedicationObject({
				obj: {
					name: this._medName.text.trim(),
					unit: this._medUnit.text.trim(),
					time: [h, m],
					dose: dose,
					color: this._colorButton.get_name(),
					taken: [entryDate.getTime(), 1],
				},
			});

			historyLS.insert_sorted(item, (a, b) => {
				const dateA = a.obj.taken[0];
				const dateB = b.obj.taken[0];
				if (dateA < dateB) return 1;
				else if (dateA > dateB) return -1;
				else return 0;
			});

			const todayDt = new Date().setHours(0, 0, 0, 0);
			const entryDt = entryDate.setHours(0, 0, 0, 0);

			for (const it of treatmentsLS) {
				const i = it.obj;
				const newIt = item.obj;
				const sameName = i.name === newIt.name;
				const updateInv = sameName && i.inventory.enabled;

				// if it's the time as of an existing item
				// update lastTaken if entryDate is today
				if (todayDt === entryDt) {
					for (const timeDose of i.dosage) {
						const sameTime = String(timeDose.time) === String(newIt.time);
						if (sameName && sameTime) {
							timeDose.lastTaken = new Date().toISOString();
							const dateKey = new Date().setHours(h, m, 0, 0);
							getDosageWindow().app.withdraw_notification(String(dateKey));
							break;
						}
					}
				}

				if (updateInv) {
					i.inventory.current -= newIt.dose;
					// trigger signal to update labels
					it.notify('obj');
					break;
				}
			}
		}
	},
);
