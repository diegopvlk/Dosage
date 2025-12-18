/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { getDosageWindow } from './main.js';
import { MedicationObject } from './medication.js';
import { TimeDoseRow } from './timeDoseRow.js';
import { sortTreatFunc } from './treatmentsSorter.js';
import {
	addLeadZero,
	addSaveKeyControllerToDialog,
	handleCalendarSelect,
} from './utils/helpers.js';
import { firstWeekday, getDayLabel, getSpecificDaysLabel } from './utils/locale.js';
import { treatmentsLS } from './window.js';

const FREQUENCIES = ['daily', 'specific-days', 'day-of-month', 'cycle', 'when-needed'];

export let dosageList;

export const MedDialog = GObject.registerClass(
	{
		GTypeName: 'MedDialog',
		Template: 'resource:///io/github/diegopvlk/Dosage/ui/med-dialog.ui',
		InternalChildren: [
			'toastOverlay',
			'saveButton',
			'medDialogClamp',
			'medName',
			'dosageColorButton',
			'dosageColorPopover',
			'dosageColorBox',
			'medUnit',
			'dosageIconButton',
			'dosageIconPopover',
			'dosageIconBox',
			'medNotes',
			'frequencyMenu',
			'frequencySpecificDays',
			'specificDaysBox',
			'frequencyDayOfMonth',
			'dayOfMonth',
			'frequencyCycle',
			'cycleActive',
			'cycleInactive',
			'cycleCurrent',
			'dosageList',
			'increasePriority',
			'recurringNotif',
			'recurringInterval',
			'medInventory',
			'medCurrrentInv',
			'medReminderInv',
			'refillAmount',
			'medDuration',
			'calendarStartRow',
			'calendarStart',
			'calendarEndRow',
			'calendarEnd',
			'markAsConfirmed',
			'deleteButton',
		],
	},
	class MedDialog extends Adw.Dialog {
		constructor(listView, itemPosition, duplicate) {
			super({});
			this._list = listView;
			this._position = itemPosition;
			this._duplicate = duplicate;
			this._existingTreatment = (listView && itemPosition >= 0) || duplicate;
			dosageList = this._dosageList;
			this._updatedItemPosition = 0;
			this.set_presentation_mode(2);
			this._initMedDialog();
			this._setDialogHeight();
		}

		_initMedDialog() {
			this._toast = new Adw.Toast();
			this._calendarDate = GLib.DateTime.new_now_local();
			const calDate = this._calendarDate.format('%x');
			this._calendarStartRow.subtitle = calDate;
			this._calendarEndRow.subtitle = calDate;

			this._setIconAndColor();

			handleCalendarSelect(this._calendarStart, this._calendarStartRow);
			handleCalendarSelect(this._calendarEnd, this._calendarEndRow);

			if (this._existingTreatment) {
				if (!this._duplicate) {
					this.title = _('Edit Treatment');
					this._saveButton.label = _('Save');
					this._deleteButton.set_visible(true);
				}

				this.set_presentation_mode(0);

				const item = this._list.get_model().get_item(this._position).obj;

				this._medName.text = item.name;
				this._medUnit.text = item.unit;
				this._medNotes.text = item.notes ? item.notes : '';

				if (this._duplicate) {
					this.set_presentation_mode(2);
					this._medName.text += ` (${_('Copy')})`;
				}

				for (const clr of this._dosageColorBox) {
					if (clr.get_name() === item.color) {
						this._dosageColorButton.add_css_class(item.color + '-clr');
						this._dosageColorButton.name = clr.get_name();
					}
				}
				for (const icn of this._dosageIconBox) {
					const icon = item.icon + '-symbolic';
					if (icn.get_icon_name() === icon) {
						this._dosageIconButton.set_icon_name(icon);
					}
				}

				item.dosage.forEach(timeDose => {
					const timeDoseRow = new TimeDoseRow(timeDose);
					this._dosageList.append(timeDoseRow.spinRow);
				});

				this._setFreqMenuVisibility(item);
				if (item.frequency === 'specific-days') {
					this._frequencyMenu.subtitle = getSpecificDaysLabel(item);
				}

				if (item.markConfirmed) {
					this._markAsConfirmed.active = true;
				}

				if (item.notification.increasePriority) {
					this._increasePriority.active = true;
				}

				if (item.notification.recurring) {
					this._recurringNotif.set_enable_expansion(item.notification.recurring.enabled);
					this._recurringInterval.value = item.notification.recurring.interval;
				}

				if (item.monthDay) {
					this._dayOfMonth.value = item.monthDay;
				}

				if (item.frequency === 'day-of-month') {
					this._handleDayOfMonthLabels();
				}

				if (item.days && item.days.length !== 0) {
					let day = firstWeekday;

					for (const btn of this._specificDaysBox) {
						for (const d of item.days) {
							if (d === day) btn.set_active(true);
						}
						day = (day + 1) % 7;
					}
				}

				if (item.cycle && item.cycle.length !== 0) {
					const [active, inactive, current] = item.cycle;

					this._cycleActive.value = active;
					this._cycleInactive.value = inactive;
					this._cycleCurrent.value = current;

					this._cycleCurrent.adjustment.set_upper(active + inactive);

					if (item.frequency === 'cycle') {
						this._frequencyMenu.subtitle = `${active} ⊷ ${inactive}`;
					}
				}

				if (item.inventory.enabled) {
					this._medInventory.set_enable_expansion(true);
				}
				this._medCurrrentInv.value = item.inventory.current;
				this._medReminderInv.value = item.inventory.reminder;
				this._refillAmount.value = item.inventory.refill;

				if (item.duration.enabled) {
					this._medDuration.set_enable_expansion(true);

					// this parsing is in seconds
					const start = GLib.DateTime.new_from_unix_local(item.duration.start / 1000);
					const end = GLib.DateTime.new_from_unix_local(item.duration.end / 1000);
					this._calendarStart.select_day(start);
					this._calendarEnd.select_day(end);
				}

				this._deleteButton.connect('activated', () => {
					confirmDeleteDialog(item, this._position, getDosageWindow(), this);
				});
			} else {
				const timeDoseRow = new TimeDoseRow({ time: [12, 30], dose: 1 });
				this._dosageList.append(timeDoseRow.spinRow);
				this._setFreqMenuVisibility();
			}

			const addDoseBtn = new Gtk.Button({
				css_classes: ['circular', 'suggested-action'],
				valign: Gtk.Align.CENTER,
				margin_end: 3,
				icon_name: 'list-add-symbolic',
				tooltip_text: _('Add Dose'),
			});

			addDoseBtn.connect('clicked', () => {
				const lastRow = dosageList.get_last_child();
				let h = lastRow.hours;
				const m = lastRow.minutes;
				const d = lastRow.value;
				const timeDoseRow = new TimeDoseRow({ time: [++h, m], dose: d });
				dosageList.append(timeDoseRow.spinRow);
			});

			this._dayOfMonth.connect('output', this._handleDayOfMonthLabels.bind(this));

			this._cycleActive.connect('output', this._handleCycle.bind(this));
			this._cycleInactive.connect('output', this._handleCycle.bind(this));

			dosageList.get_first_child().prefix.prepend(addDoseBtn);

			for (const button of this._specificDaysBox) {
				button.connect('toggled', this._setSpecificDaysFreqLabel.bind(this));
			}

			this._setSpecificDaysButtonOrder();

			addSaveKeyControllerToDialog(this, this._saveButton);
		}

		_setIconAndColor() {
			for (const clr of this._dosageColorBox) {
				clr.connect('clicked', () => {
					const cssClasses = [clr.get_name() + '-clr', 'circular'];
					this._dosageColorButton.set_css_classes(cssClasses);
					this._dosageColorButton.name = clr.get_name();
					this._dosageColorPopover.popdown();
				});
			}

			for (const icn of this._dosageIconBox) {
				icn.connect('clicked', () => {
					this._dosageIconButton.set_icon_name(icn.get_icon_name());
					this._dosageIconPopover.popdown();
				});
			}
		}

		_addOrUpdateTreatment() {
			const isUpdate = this._list && this._position >= 0 && !this._duplicate;
			const today = new GLib.DateTime();

			let days = [];
			let doses = [];
			let cycle = [];
			let invEnabled = false;
			let durEnabled = false;
			let name,
				unit,
				notes,
				color,
				frequency,
				monthDay,
				icon,
				markConfirmed,
				notification,
				inventory,
				current,
				reminder,
				refill,
				duration,
				start,
				end;

			if (this._medInventory.get_enable_expansion()) {
				invEnabled = true;
			}

			if (this._medDuration.get_enable_expansion()) {
				durEnabled = true;
				start = +this._calendarStart.get_date().format('%s') * 1000;
				end = +this._calendarEnd.get_date().format('%s') * 1000;
			} else {
				start = +today.format('%s') * 1000;
				end = start;
			}

			name = this._medName.text.trim();
			unit = this._medUnit.text.trim();
			notes = this._medNotes.text.trim();
			days = this._getSpecificDays();
			monthDay = this._dayOfMonth.value;
			doses = this._getDoses();
			markConfirmed = this._markAsConfirmed.get_active();
			notification = { recurring: {} };
			notification.increasePriority = this._increasePriority.get_active();
			notification.recurring.enabled = this._recurringNotif.get_enable_expansion();
			notification.recurring.interval = this._recurringInterval.get_value();
			cycle[0] = this._cycleActive.adjustment.value;
			cycle[1] = this._cycleInactive.adjustment.value;
			cycle[2] = this._cycleCurrent.adjustment.value;
			color = this._dosageColorButton.get_name();
			icon = this._dosageIconButton.get_icon_name().replace('-symbolic', '');
			current = this._medCurrrentInv.value;
			reminder = this._medReminderInv.value;
			refill = this._refillAmount.value;
			inventory = { enabled: invEnabled, current: current, reminder: reminder, refill: refill };
			duration = { enabled: durEnabled, start: start, end: end };

			frequency = FREQUENCIES[this._frequencyMenu.get_selected()];

			doses.sort((obj1, obj2) => {
				const [h1, m1] = obj1.time;
				const [h2, m2] = obj2.time;
				const hm1 = `${addLeadZero(h1)}${addLeadZero(m1)}`;
				const hm2 = `${addLeadZero(h2)}${addLeadZero(m2)}`;
				return hm1 === hm2 ? 0 : hm1 > hm2 ? 1 : -1;
			});

			if (isUpdate) {
				const item = this._list.get_model().get_item(this._position).obj;
				doses = doses.map((dose, idx) => {
					const lastTk = item.dosage.find(
						itDose => itDose.time[0] === dose.time[0] && itDose.time[1] === dose.time[1],
					)?.lastTaken;

					return {
						time: dose.time,
						dose: dose.dose,
						lastTaken: lastTk || null,
					};
				});
				treatmentsLS.remove(this._position);
			} else {
				doses.forEach(dose => {
					dose.lastTaken = null;
				});
			}

			const newIt = new MedicationObject({
				obj: {
					name: name,
					unit: unit,
					notes: notes,
					frequency: frequency,
					color: color,
					icon: icon,
					days: days,
					monthDay: monthDay,
					cycle: cycle,
					dosage: doses,
					notification: notification,
					inventory: inventory,
					duration: duration,
					markConfirmed: markConfirmed,
				},
			});

			treatmentsLS.insert_sorted(newIt, sortTreatFunc(settings.get_string('treatments-sorting')));

			this._updatedItemPosition = treatmentsLS.find(newIt)[1];
		}

		_getDoses() {
			const doses = [];
			let currRow = dosageList.get_first_child();

			while (currRow) {
				const ds = {
					time: [currRow.hours, currRow.minutes],
					dose: currRow.value,
				};
				doses.push(ds);
				currRow = currRow.get_next_sibling();
			}
			return doses;
		}

		_getSpecificDays() {
			const days = [];
			let day = firstWeekday;

			for (const button of this._specificDaysBox) {
				if (button.get_active()) {
					if (!days.includes(day)) {
						days.push(day);
					}
				}
				day = (day + 1) % 7;
			}
			return days.sort();
		}

		_setSpecificDaysButtonOrder() {
			let day = firstWeekday;

			for (const button of this._specificDaysBox) {
				button.label = getDayLabel(day);
				day = (day + 1) % 7;
			}
		}

		_setSpecificDaysFreqLabel() {
			if (this._getSpecificDays().length === 0) {
				this._frequencyMenu.subtitle = _('Choose');
			} else {
				this._frequencyMenu.subtitle = getSpecificDaysLabel({
					days: this._getSpecificDays(),
				});
			}
		}

		_handleDayOfMonthLabels() {
			this._frequencyMenu.title = _('Day of Month');
			this._frequencyMenu.subtitle = _('Day') + `: ${this._dayOfMonth.value}`;
		}

		_handleCycle() {
			const sum = this._cycleActive.value + this._cycleInactive.value;
			this._frequencyMenu.subtitle = this._cycleActive.value + ' ⊷ ' + this._cycleInactive.value;
			this._cycleCurrent.adjustment.set_upper(sum);
			if (this._cycleCurrent.adjustment.value > sum) {
				this._cycleCurrent.adjustment.value = sum;
			}
		}

		_setFreqMenuVisibility(item) {
			const freqRowPrefix = this._frequencyMenu.get_first_child().get_first_child();
			const selected = this._frequencyMenu.get_selected();
			freqRowPrefix.visible = selected !== 0 && selected !== 4;

			this._frequencyMenu.connect('notify::selected-item', frequencyMenu => {
				const selected = frequencyMenu.get_selected();

				freqRowPrefix.visible = selected !== 0 && selected !== 4;
				this._frequencySpecificDays.visible = selected === 1;
				this._frequencyDayOfMonth.visible = selected === 2;
				this._frequencyCycle.visible = selected === 3;

				switch (selected) {
					case 1:
						frequencyMenu.title = _('Specific Days');
						this._setSpecificDaysFreqLabel();
						break;
					case 2:
						this._handleDayOfMonthLabels();
						break;
					case 3:
						frequencyMenu.title = _('Cycle');
						this._handleCycle();
						break;
					default:
						frequencyMenu.title = _('Frequency');
				}

				// if when-needed is selected, hide mark confirmed, priority, duration and recurring
				this._markAsConfirmed.visible = selected !== 4;
				this._increasePriority.visible = selected !== 4;
				this._medDuration.visible = selected !== 4;
				this._recurringNotif.visible = selected !== 4;

				let currRow = dosageList.get_first_child();

				while (currRow) {
					currRow.prefix.sensitive = selected !== 4;
					currRow.visible = selected !== 4 || currRow === dosageList.get_first_child();
					currRow = currRow.get_next_sibling();
				}
			});

			if (item) {
				const selectedIndex = FREQUENCIES.indexOf(item.frequency);
				this._frequencyMenu.set_selected(selectedIndex);
			}
		}

		_isValidInput(isUpdate) {
			this._medName.connect('changed', name => name.remove_css_class('error'));
			this._medUnit.connect('changed', unit => unit.remove_css_class('error'));

			const emptyName = this._medName.text.trim() == '';
			const emptyUnit = this._medUnit.text.trim() == '';

			if (emptyName) {
				this._toast.dismiss();
				this._toast.title = _('Empty Name');
				this._toastOverlay.add_toast(this._toast);
				this._medName.add_css_class('error');
				return;
			} else if (emptyUnit) {
				this._toast.dismiss();
				this._toast.title = _('Empty Unit');
				this._toastOverlay.add_toast(this._toast);
				this._medUnit.add_css_class('error');
				return;
			}

			if (this._frequencySpecificDays.get_visible() && this._getSpecificDays().length == 0) {
				this._toast.title = _('Choose at Least One Day');
				this._toast.dismiss();
				this._toastOverlay.add_toast(this._toast);
				return;
			}

			for (const it of treatmentsLS) {
				const i = it.obj;
				if (isUpdate) {
					const item = this._list.get_model().get_item(this._position).obj;
					if (i === item) continue;
				}
				if (i.name.toLowerCase() === this._medName.text.trim().toLowerCase()) {
					this._toast.dismiss();
					this._toast.title = _('Name Already on Treatment List');
					this._toastOverlay.add_toast(this._toast);
					this._medName.add_css_class('error');
					return;
				}
			}

			let currRow = dosageList.get_first_child();
			const rows = [];

			while (currRow) {
				const time = String([currRow.hours, currRow.minutes]);

				if (rows.includes(time)) {
					this._toast.dismiss();
					this._toast.title = _('Duplicated Time');
					this._toastOverlay.add_toast(this._toast);
					return;
				} else {
					rows.push(time);
				}

				currRow = currRow.get_next_sibling();
			}
			return true;
		}

		_setDialogHeight() {
			const [medDialogClampHeight] = this._medDialogClamp.measure(Gtk.Orientation.VERTICAL, -1);
			this.content_height = medDialogClampHeight + 48;
		}

		_close() {
			this.force_close();
		}

		_save() {
			const isUpdate = this._list && this._position >= 0 && !this._duplicate;
			const dosageWindow = getDosageWindow();

			if (!this._isValidInput(isUpdate)) return;

			this._addOrUpdateTreatment();
			dosageWindow.updateEverything({ skipHistUp: true });
			const pos = Math.max(0, this._updatedItemPosition - 1);
			dosageWindow._treatmentsList.scroll_to(pos, Gtk.ListScrollFlags.FOCUS, null);
			this.force_close();
			dosageWindow.scheduleNotifications('saving');
		}
	},
);

export function confirmDeleteDialog(item, position, dosageWindow, medDialog) {
	const alertDialog = new Adw.AlertDialog({
		body_use_markup: true,
		heading: _('Are You Sure?'),
		body: `<b>${item.name}</b> ` + _('will be deleted'),
	});

	alertDialog.add_response('cancel', _('Cancel'));
	alertDialog.add_response('delete', _('Delete'));
	alertDialog.set_response_appearance('delete', Adw.ResponseAppearance.DESTRUCTIVE);

	if (medDialog) {
		alertDialog.present(medDialog);
	} else {
		alertDialog.present(dosageWindow);
	}

	alertDialog.connect('response', (_self, response) => {
		if (response === 'delete') {
			const it = dosageWindow._treatmentsList.model.get_item(position);
			const deletePos = treatmentsLS.find(it)[1];
			treatmentsLS.remove(deletePos);
			if (medDialog) medDialog.force_close();
			dosageWindow.updateEverything({
				skipHistUp: true,
				skipCycleUp: true,
				treatIsEmpty: treatmentsLS.n_items === 0,
			});
			dosageWindow.scheduleNotifications('deleting');
			dosageWindow._treatmentsList.scroll_to(
				Math.max(0, position - 1),
				Gtk.ListScrollFlags.FOCUS,
				null,
			);
		}
	});
}
