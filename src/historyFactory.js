/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Pango from 'gi://Pango';

import { amPmStr, clockIs12, timeDot } from './utils.js';

export const historyHeaderFactory = new Gtk.SignalListItemFactory();
export const historyItemFactory = new Gtk.SignalListItemFactory();

export let removedItem;

historyHeaderFactory.connect('setup', (factory, listHeaderItem) => {
	const dateLabel = new Gtk.Label({
		halign: Gtk.Align.START,
		margin_bottom: 1,
	});
	listHeaderItem.set_child(dateLabel);
});

historyHeaderFactory.connect('bind', (factory, listHeaderItem) => {
	const item = listHeaderItem.get_item().obj;
	const dateLabel = listHeaderItem.get_child();
	const localTZ = GLib.TimeZone.new_local();
	const dateTime = GLib.DateTime.new_from_unix_utc(item.taken[0] / 1000);
	const localDT = dateTime.to_timezone(localTZ);
	const dayName = localDT.format('%A');
	let dateFormat = localDT.format('%x');
	dateFormat = dateFormat
		.replace(`${dayName}, `, '')
		.replace(`${dayName} `, '')
		.replace(`${dayName}`, '');

	const date = dayName + ' • ' + dateFormat;
	dateLabel.label = date.charAt(0).toUpperCase() + date.slice(1);
});

historyItemFactory.connect('setup', (factory, listItem) => {
	const box = new Gtk.Box({
		css_classes: ['card'],
		height_request: 64,
	});
	const deleteButton = new Gtk.Button({
		css_classes: ['circular'],
		valign: Gtk.Align.CENTER,
		halign: Gtk.Align.CENTER,
		margin_start: 11,
	});
	box.append(deleteButton);
	const labelsBox = new Gtk.Box({
		valign: Gtk.Align.CENTER,
		hexpand: true,
		orientation: Gtk.Orientation.VERTICAL,
		margin_start: 10,
		margin_end: 10,
	});
	box.append(labelsBox);
	const name = new Gtk.Label({
		halign: Gtk.Align.START,
		margin_bottom: 1,
	});
	labelsBox.append(name);
	const dose = new Gtk.Label({
		css_classes: ['subtitle'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
	});
	labelsBox.append(dose);
	const takenBox = new Gtk.Box({
		css_classes: ['badge-box'],
		valign: Gtk.Align.CENTER,
		margin_end: 14,
	});
	const takenLabel = new Gtk.Label({
		css_classes: ['badge-content'],
		valign: Gtk.Align.CENTER,
		ellipsize: Pango.EllipsizeMode.END,
	});
	const takenIcon = new Gtk.Image({
		css_classes: ['badge-content', 'badge-icon'],
		icon_name: 'check-confirmed',
	});
	takenBox.append(takenLabel);
	takenBox.append(takenIcon);
	box.append(takenBox);
	listItem.set_child(box);

	deleteButton.connect('clicked', () => {
		const item = listItem.get_item();
		const listView = box.get_parent().get_parent();
		const listStore = listView.get_model().get_model().get_model();
		let position = listItem.get_position();

		removedItem = item;
		let [, pos] = listStore.find(item);
		listStore.remove(pos);

		if (listView.get_model().get_n_items() === position) {
			// if it's the last position, position - 1
			// otherwise it causes a crash
			position--;
		}

		if (position >= 0) {
			listView.scroll_to(position, Gtk.ListScrollFlags.FOCUS, null);
		}
		removedItem = undefined;
	});
});

historyItemFactory.connect('bind', (factory, listItem) => {
	const item = listItem.get_item().obj;
	const box = listItem.get_child();
	const row = box.get_parent();
	const deleteButton = box.get_first_child();
	const labelsBox = box.get_first_child().get_next_sibling();
	const nameLabel = labelsBox.get_first_child();
	const doseLabel = nameLabel.get_next_sibling();
	const takenBox = box.get_last_child();
	const takenLabel = takenBox.get_first_child();
	const takenIcon = takenLabel.get_next_sibling();
	const localTZ = GLib.TimeZone.new_local();
	const dateTimeTaken = GLib.DateTime.new_from_unix_utc(item.taken[0] / 1000);
	const timeTaken = dateTimeTaken.to_timezone(localTZ);
	const dateNow = GLib.DateTime.new_now_local();

	// activate item with space bar
	const keyController = new Gtk.EventControllerKey();
	keyController.connect('key-pressed', (_, keyval, keycode, state) => {
		if (keyval === Gdk.KEY_space) {
			let listView = row.get_parent();
			listView.emit('activate', listItem.position);
		}
	});
	row.add_controller(keyController);

	row.remove_css_class('activatable');
	box.add_css_class('activatable');

	if (timeTaken.format('%F') == dateNow.format('%F')) {
		deleteButton.icon_name = 'edit-undo-symbolic';
		deleteButton.tooltip_text = _('Restore');
	} else {
		deleteButton.icon_name = 'user-trash-symbolic';
		deleteButton.tooltip_text = _('Delete');
	}

	let [hours, minutes] = item.time;
	let period = '';
	if (clockIs12) {
		period = ` ${amPmStr[0]}`;
		if (hours >= 12) period = ` ${amPmStr[1]}`;
		if (hours > 12) hours -= 12;
		if (hours === 0) hours = 12;
	}

	const h = clockIs12 ? String(hours) : String(hours).padStart(2, 0);
	const m = String(minutes).padStart(2, 0);

	let time = `${h}:${m}`;
	if (timeDot) time = time.replace(':', '.');

	nameLabel.label = item.name;
	doseLabel.label = `${item.dose} ${item.unit} • ${time}` + period;

	let takenH = clockIs12 ? timeTaken.format('%l') : timeTaken.format('%k');
	takenH = takenH.replace(' ', '');
	takenH = clockIs12 ? takenH : takenH.padStart(2, 0);
	let takenM = timeTaken.format('%M');
	let timeTk = `${takenH}:${takenM}`;
	if (timeDot) timeTk = timeTk.replace(':', '.');
	const takenTime = clockIs12 ? `${timeTk} ${timeTaken.format('%p')}` : `${timeTk}`;

	if (item.taken[1] === 1) {
		takenLabel.label = `${takenTime}`;
		takenIcon.set_visible(true);
		takenLabel.add_css_class('badge-end-border');
	} else if (item.taken[1] === 0) {
		takenLabel.label = _('Skipped');
		takenIcon.set_visible(false);
		takenLabel.remove_css_class('badge-end-border');
	} else if (item.taken[1] === -1) {
		takenLabel.label = _('Missed');
		takenIcon.set_visible(false);
		takenLabel.remove_css_class('badge-end-border');
	}

	['default', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple'].forEach(c =>
		box.remove_css_class(c),
	);

	box.add_css_class(item.color);
});
