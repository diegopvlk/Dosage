/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

export const DataDir = Gio.file_new_for_path(GLib.build_filenamev([GLib.get_user_data_dir()]));

export function addLeadZero(input) {
	return String(input).padStart(2, 0);
}

export function isValidTreatmentItem(it) {
	const item = it.obj ? it.obj : it;

	const isValidItem =
		typeof item.name === 'string' &&
		item.name.trim() !== '' && // name cannot be empty
		typeof item.unit === 'string' &&
		item.unit.trim() !== '' && // unit cannot be empty
		typeof item.notes === 'string' &&
		typeof item.frequency === 'string' &&
		// frequency cannot be empty
		item.frequency !== '' &&
		// if frequency is 'specific-days', 'days' cannot be empty
		(item.frequency !== 'specific-days' || item.days.length > 0) &&
		// if frequency is 'day-of-month', 'monthDay' cannot be empty
		(item.frequency !== 'day-of-month' || typeof item.monthDay === 'number') &&
		typeof item.color === 'string' &&
		item.color !== '' && // color cannot be empty
		typeof item.icon === 'string' &&
		item.icon !== '' && // icon cannot be empty
		Array.isArray(item.days) &&
		// days must contain only numbers
		item.days.every(day => typeof day === 'number') &&
		Array.isArray(item.cycle) &&
		item.cycle.length > 0 && // cycle cannot be empty
		// cycle must contain only numbers
		item.cycle.every(day => typeof day === 'number') &&
		Array.isArray(item.dosage) &&
		item.dosage.length > 0 && // dosage must have at least one object
		item.dosage.every(
			d =>
				Array.isArray(d.time) &&
				d.time.length === 2 &&
				typeof d.time[0] === 'number' &&
				typeof d.time[1] === 'number' &&
				typeof d.dose === 'number' &&
				(d.lastTaken === null || typeof d.lastTaken === 'string'),
		) &&
		typeof item.markConfirmed === 'boolean' &&
		typeof item.notification === 'object' &&
		typeof item.notification.increasePriority === 'boolean' &&
		typeof item.notification.recurring === 'object' &&
		typeof item.notification.recurring.enabled === 'boolean' &&
		typeof item.notification.recurring.interval === 'number' &&
		typeof item.inventory === 'object' &&
		typeof item.inventory.enabled === 'boolean' &&
		typeof item.inventory.current === 'number' &&
		typeof item.inventory.reminder === 'number' &&
		typeof item.inventory.refill === 'number' &&
		typeof item.duration === 'object' &&
		typeof item.duration.enabled === 'boolean' &&
		typeof item.duration.start === 'number' &&
		typeof item.duration.end === 'number' &&
		// cycleNextDate is present only if frequency is 'cycle'
		(item.frequency !== 'cycle' || typeof item.cycleNextDate === 'string');

	if (!isValidItem) {
		throw `Invalid treatment item\n\n${JSON.stringify(item)}`;
	}

	return true;
}

export function isValidHistoryItem(it) {
	const item = it.obj ? it.obj : it;

	const isValidItem =
		typeof item.name === 'string' &&
		item.name.trim() !== '' &&
		typeof item.unit === 'string' &&
		item.unit.trim() !== '' &&
		Array.isArray(item.time) &&
		item.time.length === 2 &&
		typeof item.time[0] === 'number' &&
		typeof item.time[1] === 'number' &&
		typeof item.dose === 'number' &&
		typeof item.color === 'string' &&
		item.color !== '' &&
		Array.isArray(item.taken) &&
		item.taken.length === 2 &&
		typeof item.taken[0] === 'number' &&
		typeof item.taken[1] === 'number';

	if (!isValidItem) {
		throw `Invalid history item\n\n${JSON.stringify(item)}`;
	}

	return true;
}

/**
 * Create a valid temporary js object.
 *
 * @param {string} type - `"history"` or `"treatments"`.
 * @param {Gio.ListStore} listStore - The treatments or history ListStore
 * @param {boolean} lsIsEmpty - If the ListStore is empty, returns `{ [type]: [] }
 *
 */
export function createTempObj(type, listStore, lsIsEmpty) {
	const tempObj = {};
	tempObj[type] = [];
	let isValid = false;

	if (lsIsEmpty) return tempObj;

	for (const it of listStore) {
		const item = it.obj;

		if (type === 'history') {
			isValid = isValidHistoryItem(it);
		} else {
			isValid = isValidTreatmentItem(it);
		}

		if (isValid) tempObj[type].push(item);
		else break;
	}

	if (isValid) {
		if (type === 'treatments') {
			tempObj.treatments.sort((a, b) => a.name.localeCompare(b.name));
		}
		return tempObj;
	}
}

export function handleCalendarSelect(calendar, calendarRow, oneTime) {
	const today = GLib.DateTime.new_now_local().format('%F');

	calendar.connect('day-selected', cal => handleSelect(cal));
	calendar.connect('next-month', cal => handleSelect(cal));
	calendar.connect('next-year', cal => handleSelect(cal));
	calendar.connect('prev-month', cal => handleSelect(cal));
	calendar.connect('prev-year', cal => handleSelect(cal));

	function handleSelect(cal) {
		const selDate = cal.get_date().format('%F');

		if (oneTime && selDate > today) {
			(async function () {
				cal.add_css_class('calendar-error');
				await new Promise(res => setTimeout(res, 500));
				cal.remove_css_class('calendar-error');
			})();
			cal.select_day(GLib.DateTime.new_now_local());
		}

		calendarRow.subtitle = cal.get_date().format('%x');
	}
}

export function isTodayMedDay(
	today,
	frequency,
	durationEnabled,
	start,
	end,
	cycle,
	days,
	monthDay,
) {
	if (durationEnabled && (start > today || end < today)) {
		return false;
	}

	switch (frequency) {
		case 'daily':
			return true;
		case 'specific-days':
			return days.includes(today.getDay());
		case 'day-of-month':
			return monthDay === today.getDate();
		case 'cycle':
			const [active, _inactive, current] = cycle;
			return current <= active;
		default:
			return false;
	}
}

export function datesPassedDiff(startDate, endDate) {
	const start = new Date(startDate).setHours(0, 0, 0, 0);
	const end = new Date(endDate).setHours(0, 0, 0, 0);
	const daysDiff = Math.floor((end - start) / 86400000);
	const datesPassed = [];

	for (let i = 1; i <= daysDiff; i++) {
		const currentDate = new Date(startDate);
		currentDate.setHours(0, 0, 0, 0);
		currentDate.setDate(currentDate.getDate() + i);
		datesPassed.push(currentDate);
	}

	return datesPassed;
}

export function addSaveKeyControllerToDialog(dialog, saveBtn) {
	const keyController = new Gtk.EventControllerKey();
	keyController.connect('key-pressed', (_, keyval, keycode, state) => {
		const shiftPressed = (state & Gdk.ModifierType.SHIFT_MASK) !== 0;
		const controlPressed = (state & Gdk.ModifierType.CONTROL_MASK) !== 0;
		const enterPressed = keyval === Gdk.KEY_Return;

		if ((controlPressed || shiftPressed) && enterPressed && saveBtn.sensitive) {
			saveBtn.activate();
		}
	});
	dialog.add_controller(keyController);
}

export const HistorySectionSorter = GObject.registerClass(
	{},
	class HistorySectionSorter extends Gtk.Sorter {
		vfunc_compare(a, b) {
			const dtA = new Date(a.obj.taken[0]).setHours(0, 0, 0, 0);
			const dtB = new Date(b.obj.taken[0]).setHours(0, 0, 0, 0);

			return dtA === dtB ? 0 : dtA < dtB ? 1 : -1;
		}
	},
);

export const TodaySectionSorter = GObject.registerClass(
	{},
	class TodaySectionSorter extends Gtk.Sorter {
		vfunc_compare(a, b) {
			let [h1, m1] = a.obj.time;
			let [h2, m2] = b.obj.time;

			const wnA = a.obj.frequency === 'when-needed';
			const wnB = b.obj.frequency === 'when-needed';

			if (wnA) [h1, m1] = [-1, -1];
			if (wnB) [h2, m2] = [-1, -1];

			const hm1 = `${addLeadZero(h1)}${addLeadZero(m1)}`;
			const hm2 = `${addLeadZero(h2)}${addLeadZero(m2)}`;

			return hm1 === hm2 ? 0 : hm1 > hm2 ? 1 : -1;
		}
	},
);
