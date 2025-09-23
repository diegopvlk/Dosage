/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import { getSpecificDaysLabel } from './utils.js';
import { DosageApplication } from './main.js';
import { confirmDeleteDialog } from './medDialog.js';
import { openRefillDialog } from './refillDialog.js';

export const treatmentsFactory = new Gtk.SignalListItemFactory();

let delayDialog = false;
let ref = 0;

treatmentsFactory.connect('setup', (factory, listItem) => {
	listItem.box = new Gtk.Box({
		css_name: 'item-box',
	});

	listItem.altClick = new Gtk.GestureClick({ button: 3 });

	// right click menu
	listItem.altClick.connect('pressed', (_gestureClick, _nPress, x, y) => {
		const position = new Gdk.Rectangle({ x: x, y: y });
		listItem.popoverMenu.pointing_to = position;
		listItem.popoverMenu.popup();
	});

	listItem.box.add_controller(listItem.altClick);

	listItem.icon = new Gtk.Image({
		margin_start: 16,
		margin_end: 6,
		icon_name: 'pill-symbolic',
	});

	listItem.box.append(listItem.icon);

	listItem.labelsBox = new Gtk.Box({
		valign: Gtk.Align.CENTER,
		hexpand: true,
		orientation: Gtk.Orientation.VERTICAL,
		margin_start: 8,
		margin_end: 11,
		margin_top: 2,
		margin_bottom: 2,
	});

	listItem.box.append(listItem.labelsBox);

	listItem.nameLabel = new Gtk.Label({
		css_classes: ['title'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
		margin_bottom: 1,
	});

	listItem.labelsBox.append(listItem.nameLabel);

	listItem.infoLabel = new Gtk.Label({
		css_classes: ['subtitle'],
		halign: Gtk.Align.START,
		justify: Gtk.Justification.FILL,
		wrap: true,
		natural_wrap_mode: Gtk.NaturalWrapMode.NONE,
	});

	listItem.labelsBox.append(listItem.infoLabel);

	listItem.durationNextDateLabel = new Gtk.Label({
		css_classes: ['subtitle'],
		halign: Gtk.Align.START,
		ellipsize: Pango.EllipsizeMode.END,
		visible: false,
		margin_top: 1,
	});

	listItem.labelsBox.append(listItem.durationNextDateLabel);

	listItem.invLabelBtn = new Gtk.Button({
		css_name: 'badge-button',
		valign: Gtk.Align.CENTER,
		margin_end: 5,
		visible: false,
		tooltip_text: _('Refill stock'),
	});

	listItem.invLabelBtn.connect('clicked', btn => {
		if (!delayDialog) {
			openRefillDialog(listItem, listItem.item);
			delayDialog = true;
			setTimeout(() => {
				delayDialog = false;
			}, 500);
		}
	});

	listItem.box.append(listItem.invLabelBtn);

	listItem.optionsMenu = new Gio.Menu();

	listItem.optionsMenu.append(_('Edit'), `app.edit${ref}`);
	listItem.optionsMenu.append(_('Refill'), `app.refill${ref}`);
	listItem.optionsMenu.append(_('Duplicate'), `app.dup${ref}`);
	listItem.optionsMenu.append(_('Delete'), `app.del${ref}`);

	listItem.editAct = new Gio.SimpleAction({ name: `edit${ref}` });
	listItem.refillAct = new Gio.SimpleAction({ name: `refill${ref}` });
	listItem.duplicateAct = new Gio.SimpleAction({ name: `dup${ref}` });
	listItem.deleteAct = new Gio.SimpleAction({ name: `del${ref}` });

	ref++;

	listItem.popoverMenu = new Gtk.PopoverMenu({
		halign: Gtk.Align.START,
		has_arrow: false,
		menu_model: listItem.optionsMenu,
	});

	listItem.box.append(listItem.popoverMenu);

	listItem.optionsButton = new Gtk.MenuButton({
		tooltip_text: _('Options'),
		css_classes: ['circular'],
		valign: Gtk.Align.CENTER,
		margin_start: 5,
		margin_end: 12,
		icon_name: 'view-more-symbolic',
		menu_model: listItem.optionsMenu,
	});

	listItem.box.append(listItem.optionsButton);
	listItem.set_child(listItem.box);

	listItem.keyController = new Gtk.EventControllerKey();

	// activate item with space bar
	listItem.keyController.connect('key-pressed', (_, keyval, keycode, state) => {
		if (keyval === Gdk.KEY_space) {
			const row = listItem.box.parent;
			const listView = row.parent;
			listView.emit('activate', listItem.position);
		}
	});

	listItem.controllerAndSignals = false;
});

treatmentsFactory.connect('bind', (factory, listItem) => {
	const { box, nameLabel, icon } = listItem;
	const item = listItem.item.obj;

	if (!listItem.controllerAndSignals) {
		const DosageWindow = DosageApplication.get_default().activeWindow;
		const app = DosageWindow.application;
		const row = box.parent;

		row.add_controller(listItem.keyController);

		row.connect('unrealize', () => {
			app.remove_action(listItem.editAct.get_name());
			app.remove_action(listItem.refillAct.get_name());
			app.remove_action(listItem.duplicateAct.get_name());
			app.remove_action(listItem.deleteAct.get_name());
		});

		listItem.item.connect('notify::obj', () => {
			setInventoryAndDateLabels(listItem);
		});

		listItem.editAct.connect('activate', () => {
			const listView = row.parent;
			listView.emit('activate', listItem.position);
		});

		if (item.inventory.enabled) {
			listItem.refillAct.connect('activate', () => {
				openRefillDialog(listItem, listItem.position);
			});
			app.add_action(listItem.refillAct);
		}

		listItem.duplicateAct.connect('activate', () => {
			const list = DosageWindow._treatmentsList;
			DosageWindow.openMedDialog(list, listItem.position, 'duplicate');
		});

		listItem.deleteAct.connect('activate', () => {
			confirmDeleteDialog(item, listItem.position, DosageWindow);
		});

		app.add_action(listItem.editAct);
		app.add_action(listItem.duplicateAct);
		app.add_action(listItem.deleteAct);

		listItem.controllerAndSignals = true;
	}

	nameLabel.label = item.name;
	icon.icon_name = item.icon;

	setInventoryAndDateLabels(listItem);

	box.css_classes = [item.color];
});

function setInventoryAndDateLabels(listItem) {
	const item = listItem.item.obj;
	const { infoLabel, durationNextDateLabel, invLabelBtn } = listItem;
	const today = new Date().setHours(0, 0, 0, 0);
	const start = new Date(item.duration.start).setHours(0, 0, 0, 0);
	const end = new Date(item.duration.end).setHours(0, 0, 0, 0);
	const inv = item.inventory;

	if (inv.enabled) {
		let currInv = inv.current < 0 ? 0 : inv.current;

		invLabelBtn.visible = true;
		// TRANSLATORS: keep the %d it's where the number goes
		invLabelBtn.label = _('%d Remaining').replace('%d', currInv);
		invLabelBtn.remove_css_class('low-stock');

		if (inv.current <= inv.reminder) {
			invLabelBtn.label = `${currInv} ↓ ` + _('Low stock');
			invLabelBtn.add_css_class('low-stock');
		}
	}

	// TRANSLATORS: label for when duration is enabled
	const startLabel = _('Starts on') + ` ${formatDate(item.duration.start)}`;
	const untilLabel = _('Until') + ` ${formatDate(item.duration.end)}`;
	const endedLabel = _('Ended on') + ` ${formatDate(item.duration.end)}`;

	if (item.duration.enabled && item.frequency !== 'when-needed') {
		durationNextDateLabel.visible = true;
		durationNextDateLabel.label = untilLabel;
		if (start > today) {
			durationNextDateLabel.label = startLabel;
		}
	}

	switch (item.frequency) {
		case 'daily':
			infoLabel.label = _('Daily');
			break;
		case 'specific-days':
			infoLabel.label = getSpecificDaysLabel(item);
			break;
		case 'day-of-month':
			infoLabel.label = _('Day') + `: ${item.monthDay}`;
			break;
		case 'cycle':
			const nextDt = new Date(item.cycleNextDate).setHours(0, 0, 0, 0);
			const nextDate = formatDate(nextDt);

			if (item.duration.enabled) {
				durationNextDateLabel.label = untilLabel;
				if (nextDt > today && nextDt <= end) {
					durationNextDateLabel.label += ' ⦁ ' + _('Next dose') + `: ${nextDate}`;
				}
			} else if (nextDt > today) {
				durationNextDateLabel.label = _('Next dose') + `: ${nextDate}`;
			}

			if (nextDt <= today && !item.duration.enabled) {
				durationNextDateLabel.visible = false;
			} else {
				durationNextDateLabel.visible = true;
			}

			infoLabel.label = `${_('Cycle')} ⦁ ${item.cycle[0]} ⊷ ${item.cycle[1]}`;
			break;
		case 'when-needed':
			infoLabel.label = _('When necessary');
			break;
	}

	if (item.notes !== '') infoLabel.label += ` ⦁ ${item.notes}`;

	if (item.duration.enabled && (end < today || end < start)) {
		durationNextDateLabel.label = endedLabel;
	}
}

function formatDate(dt) {
	const date = GLib.DateTime.new_from_unix_local(dt / 1000);
	return date.format('%x');
}
