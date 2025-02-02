/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Pango from 'gi://Pango';

import { dateFormat, timeFormat } from './utils.js';
import { historyLS } from './window.js';

export const historyHeaderFactory = new Gtk.SignalListItemFactory();
export const historyItemFactory = new Gtk.SignalListItemFactory();

export let removedItem;

historyHeaderFactory.connect('setup', (factory, listHeaderItem) => {
	listHeaderItem.dateLabel = new Gtk.Label({
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
		margin_bottom: 1,
	});

	listHeaderItem.set_child(listHeaderItem.dateLabel);
});

historyHeaderFactory.connect('bind', (factory, listHeaderItem) => {
	const item = listHeaderItem.get_item().obj;
	const dateLabel = listHeaderItem.dateLabel;

	const dateTime = GLib.DateTime.new_from_unix_local(item.taken[0] / 1000);
	const formattedDt = dateTime.format(dateFormat);

	dateLabel.label = formattedDt.charAt(0).toUpperCase() + formattedDt.slice(1);
});

historyItemFactory.connect('setup', (factory, listItem) => {
	listItem.box = new Gtk.Box();

	listItem.deleteButton = new Gtk.Button({
		css_classes: ['circular'],
		valign: Gtk.Align.CENTER,
		halign: Gtk.Align.CENTER,
		margin_start: 11,
	});

	listItem.box.append(listItem.deleteButton);

	listItem.labelsBox = new Gtk.Box({
		valign: Gtk.Align.CENTER,
		hexpand: true,
		orientation: Gtk.Orientation.VERTICAL,
		margin_start: 10,
		margin_end: 10,
	});

	listItem.box.append(listItem.labelsBox);

	listItem.nameLabel = new Gtk.Label({
		css_classes: ['title'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
		margin_bottom: 1,
	});

	listItem.labelsBox.append(listItem.nameLabel);

	listItem.doseLabel = new Gtk.Label({
		css_classes: ['subtitle'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
	});

	listItem.labelsBox.append(listItem.doseLabel);

	listItem.takenBox = new Gtk.Box({
		css_classes: ['badge-box'],
		valign: Gtk.Align.CENTER,
		margin_end: 14,
	});

	listItem.takenLabel = new Gtk.Label({
		css_classes: ['badge-content'],
		valign: Gtk.Align.CENTER,
		ellipsize: Pango.EllipsizeMode.END,
	});

	listItem.takenIcon = new Gtk.Image({
		css_classes: ['badge-content', 'badge-icon'],
		icon_name: 'check-confirmed',
	});

	listItem.takenBox.append(listItem.takenLabel);
	listItem.takenBox.append(listItem.takenIcon);
	listItem.box.append(listItem.takenBox);
	listItem.set_child(listItem.box);

	listItem.deleteButton.connect('clicked', () => {
		const item = listItem.get_item();
		const listView = listItem.box.get_parent().get_parent();
		let position = listItem.get_position();

		removedItem = item;
		let [, pos] = historyLS.find(item);
		historyLS.remove(pos);

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
	const box = listItem.box;
	const row = box.get_parent();
	const deleteButton = listItem.deleteButton;
	const nameLabel = listItem.nameLabel;
	const doseLabel = listItem.doseLabel;
	const takenLabel = listItem.takenLabel;
	const takenIcon = listItem.takenIcon;
	const today = new Date().setHours(0, 0, 0, 0);
	const itemDate = new Date(item.taken[0]).setHours(0, 0, 0, 0);

	const itemTakenDate = GLib.DateTime.new_from_unix_local(item.taken[0] / 1000);
	const itemTime = GLib.DateTime.new_local(1, 1, 1, item.time[0], item.time[1], 1);
	const time = itemTime.format(timeFormat);
	const timeTaken = itemTakenDate.format(timeFormat);

	// activate item with space bar
	const keyController = new Gtk.EventControllerKey();
	keyController.connect('key-pressed', (_, keyval, keycode, state) => {
		if (keyval === Gdk.KEY_space) {
			let listView = row.get_parent();
			listView.emit('activate', listItem.position);
		}
	});
	row.add_controller(keyController);

	if (today === itemDate) {
		deleteButton.icon_name = 'edit-undo-symbolic';
		deleteButton.tooltip_text = _('Restore');
	} else {
		deleteButton.icon_name = 'user-trash-symbolic';
		deleteButton.tooltip_text = _('Delete');
	}

	nameLabel.label = item.name;
	doseLabel.label = `${item.dose} ${item.unit} • ${time}`;

	takenIcon.set_visible(item.taken[1] === 1);

	if (item.taken[1] === 1) takenLabel.label = timeTaken;
	else if (item.taken[1] === 0) takenLabel.label = _('Skipped');
	else if (item.taken[1] === -1) takenLabel.label = _('Missed');

	box.set_css_classes(['item-box', item.color]);
});
