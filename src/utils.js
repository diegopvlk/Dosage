/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';

export const isoWeekStart = weekStartsMonday();

function weekStartsMonday() {
	const date = new Date(2000, 9, 0);
	const startOfYear = new Date(2000, 0, 1);
	const dayOfYear = Math.floor((date - startOfYear) / 86400000) + 1;
	const weekNumber = Math.ceil(dayOfYear / 7);

	// 39 = starts on monday
	// 40 = starts on sunday
	return weekNumber === 39;
}

export function getSpecificDaysLabel(item) {
	const isWeekend = item.days.every(day => [0, 6].includes(day));
	const isWeekdays = item.days.every(day => [1, 2, 3, 4, 5].includes(day));
	let newLabel;

	if (item.days.length === 1) {
		newLabel = getDayLabel(item.days[0], 'long');
	} else if (isWeekend) {
		newLabel = _('Weekends');
	} else if (isWeekdays && item.days.length === 5) {
		newLabel = _('Weekdays');
	} else if (item.days.length === 7) {
		newLabel = _('Daily');
	} else {
		const days = isoWeekStart ? [...item.days.slice(1), item.days[0]] : item.days;
		newLabel = days.map(day => getDayLabel(day)).join(', ');
	}

	return newLabel;
}

export const clockIs12 = checkClock();

function checkClock() {
	const currentTime = GLib.DateTime.new_now_local();
	const timeFormat = currentTime.format('%X').slice(-2);
	return timeFormat === 'AM' || timeFormat === 'PM';
}

export const DataDir = Gio.file_new_for_path(GLib.build_filenamev([GLib.get_user_data_dir()]));

export function addLeadZero(input) {
	return String(input).padStart(2, 0);
}

export function removeCssColors(colorBtn) {
	const colors = colorBtn.get_css_classes();
	for (const c of colors) {
		if (c.includes('-clr')) {
			colorBtn.remove_css_class(c);
		}
	}
}

export function createTempObj(type, listStore) {
	if (type === 'treatments') {
		const tempObj = {
			treatments: [],
			lastUpdate: new Date().toISOString(),
		};
		for (const it of listStore) {
			tempObj.treatments.push(it.obj);
		}
		if (
			tempObj.treatments.some(obj => Object.keys(obj).length === 0) ||
			tempObj.treatments.length === 0
		) {
			log(JSON.stringify(tempObj));
			return;
		}
		return tempObj;
	} else if (type === 'history') {
		const tempObj = {
			history: {},
		};
		const hist = tempObj.history;
		for (const it of listStore) {
			const item = it.obj;
			const dateKey = new Date(item.taken[0]).setHours(0, 0, 0, 0);

			if (!hist[dateKey]) {
				hist[dateKey] = [];
			}

			hist[dateKey].push({
				name: item.name,
				unit: item.unit,
				time: item.time,
				dose: item.dose,
				color: item.color,
				taken: item.taken,
			});
		}
		if (hasEmptyObject(hist)) {
			log(JSON.stringify(tempObj));
			return;
		}
		return tempObj;
	}
}

function hasEmptyObject(data) {
	for (const key in data) {
		return data[key].some(obj => Object.keys(obj).length === 0);
	}
}

export function handleCalendarSelect(calendar, calendarRow, oneTime) {
	const today = GLib.DateTime.new_now_local().format('%F');
	calendar.connect('day-selected', cal => {
		const selDate = cal.get_date().format('%F');

		if (oneTime && selDate > today) {
			(async function () {
				cal.add_css_class('calendar-error');
				await new Promise(res => setTimeout(res, 500));
				cal.remove_css_class('calendar-error');
			})();
			cal.select_day(GLib.DateTime.new_now_local());
		}

		if (!oneTime && selDate < today) {
			cal.add_css_class('calendar-warning');
		} else {
			cal.remove_css_class('calendar-warning');
		}

		calendarRow.subtitle = cal.get_date().format('%x');
	});
}

export function isTodayMedDay(med) {
	const item = med.obj;
	const today = new Date().setHours(0, 0, 0, 0);
	const start = new Date(item.duration.start).setHours(0, 0, 0, 0);
	const end = new Date(item.duration.end).setHours(0, 0, 0, 0);

	if (item.lastTaken !== null) {
		return new Date(item.lastTaken) < today;
	}

	if (item.duration.enabled && (start > today || end < today)) {
		return false;
	}

	switch (item.frequency) {
		case 'daily':
			return true;
		case 'specific-days':
			return item.days.includes(new Date().getDay());
		case 'cycle':
			const [active, inactive, current] = item.cycle;
			return current <= active;
		case 'when-needed':
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

export function doseRow(timeDose) {
	let [hours, minutes] = timeDose.time;
	let period = '';

	if (clockIs12) {
		period = hours < 12 ? 'AM' : 'PM';
		if (hours > 12) hours -= 12;
		if (hours === 0) hours = 12;
	}

	const doseRow = new Adw.SpinRow({
		climb_rate: 0.2,
		digits: 2,
		adjustment: new Gtk.Adjustment({
			lower: 0.25,
			upper: 999,
			step_increment: 0.25,
			value: timeDose.dose,
		}),
	});
	const doseBox = new Gtk.Box();
	const removeDoseButton = new Gtk.Button({
		css_classes: ['circular', 'destructive-action', 'remove-row'],
		opacity: 0.85,
		valign: Gtk.Align.CENTER,
		margin_end: 4,
		icon_name: 'user-trash-symbolic',
		tooltip_text: _('Delete dose'),
	});
	const doseTimeBox = new Gtk.Box({
		css_classes: ['time-box'],
	});
	const adjHours = new Gtk.Adjustment({
		lower: 0,
		upper: 23,
		step_increment: 1,
		value: hours,
	});
	const spinButtonHours = new Gtk.SpinButton({
		orientation: Gtk.Orientation.VERTICAL,
		valign: Gtk.Align.CENTER,
		numeric: true,
		wrap: true,
		adjustment: adjHours,
	});
	const adjMinutes = new Gtk.Adjustment({
		lower: 0,
		upper: 59,
		step_increment: 5,
		value: minutes,
	});
	const spinButtonMinutes = new Gtk.SpinButton({
		orientation: Gtk.Orientation.VERTICAL,
		valign: Gtk.Align.CENTER,
		numeric: true,
		wrap: true,
		adjustment: adjMinutes,
	});
	const spinButtonSeparator = new Gtk.Label({
		label: ' : ',
	});

	doseTimeBox.append(spinButtonHours);
	doseTimeBox.append(spinButtonSeparator);
	doseTimeBox.append(spinButtonMinutes);

	const leadZeroHours = addLeadZero(adjHours.value);
	const leadZeroMinutes = addLeadZero(adjMinutes.value);
	const doseTimeButton = new Gtk.MenuButton({
		css_classes: ['flat', 'numeric', 'time'],
		label: `${leadZeroHours}∶${leadZeroMinutes}`,
		valign: Gtk.Align.CENTER,
		popover: new Gtk.Popover({
			child: doseTimeBox,
		}),
	});

	spinButtonHours.connect('output', h => {
		spinButtonHours.text = addLeadZero(h.adjustment.value);
		doseTimeButton.label = `${spinButtonHours.text}∶${spinButtonMinutes.text}`;
		return true;
	});
	spinButtonMinutes.connect('output', m => {
		spinButtonMinutes.text = addLeadZero(m.adjustment.value);
		doseTimeButton.label = `${spinButtonHours.text}∶${spinButtonMinutes.text}`;
		return true;
	});

	const amPmButton = new Gtk.Button({
		css_classes: ['am-pm', 'circular', 'flat'],
		valign: Gtk.Align.CENTER,
		label: period,
		visible: clockIs12,
	});
	amPmButton.connect('clicked', btn => {
		btn.label = btn.label === 'AM' ? 'PM' : 'AM';
	});

	if (clockIs12) {
		adjHours.lower = 1;
		adjHours.upper = 12;
	}

	doseBox.append(removeDoseButton);
	doseBox.append(doseTimeButton);
	doseBox.append(amPmButton);
	doseRow.add_prefix(doseBox);

	doseRow.add_css_class('ampm-row');

	removeDoseButton.connect('clicked', () => {
		removeRow(doseRow);
	});

	return doseRow;
}

export function getTimeBtnInput(currentDoseRow) {
	// TODO: need a better way to get these widgets
	const timeButton = currentDoseRow
		.get_first_child()
		.get_first_child()
		.get_first_child()
		.get_first_child()
		.get_next_sibling();
	const hourInput = timeButton.get_popover().get_first_child().get_first_child().get_first_child();
	const minutesInput = timeButton
		.get_popover()
		.get_first_child()
		.get_first_child()
		.get_last_child();

	const ampm = timeButton.get_next_sibling();
	const period = ampm.label;

	let hours = hourInput.get_value();
	let minutes = minutesInput.get_value();

	// The time is stored in 24h format
	if (clockIs12) {
		if (period === 'AM' && hours === 12) hours = 0;
		if (period === 'PM' && hours !== 12) hours += 12;
	}

	return [hours, minutes, ampm, timeButton];
}

export function getDayLabel(day, long) {
	const now = GLib.DateTime.new_now_local();
	const date = now.add_days((day - now.get_day_of_week() + 7) % 7);
	const dayLabel = date.format(long ? '%A' : '%a');
	return dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1);
}

export const HistorySectionSorter = GObject.registerClass(
	{},
	class HistorySectionSorter extends Gtk.Sorter {
		_init(params) {
			super._init(params);
		}

		vfunc_compare(a, b) {
			const dtA = new Date(a.obj.taken[0]).setHours(0, 0, 0, 0);
			const dtB = new Date(b.obj.taken[0]).setHours(0, 0, 0, 0);

			return dtA === dtB ? 0 : dtA < dtB ? 1 : -1;
		}
	},
);

export const HistorySorter = GObject.registerClass(
	{},
	class HistorySorter extends Gtk.Sorter {
		_init(params) {
			super._init(params);
		}

		vfunc_compare(a, b) {
			return a.obj.taken[0] > b.obj.taken[0] ? -1 : 0;
		}
	},
);

export const TodaySectionSorter = GObject.registerClass(
	{},
	class TodaySectionSorter extends Gtk.Sorter {
		_init(params) {
			super._init(params);
		}

		vfunc_compare(a, b) {
			const [h1, m1] = a.obj.time;
			const [h2, m2] = b.obj.time;

			const hm1 = `${addLeadZero(h1)}${addLeadZero(m1)}`;
			const hm2 = `${addLeadZero(h2)}${addLeadZero(m2)}`;

			return hm1 === hm2 ? 0 : hm1 > hm2 ? 1 : -1;
		}
	},
);
