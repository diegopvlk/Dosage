/*
 * Copyright 2023 Diego Povliuk
 * SPDX-License-Identifier: GPL-3.0-only
 */
'use strict';

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';

import { Medication, HistoryMedication, TodayMedication } from './medication.js';
import { todayHeaderFactory, todayItemFactory } from './todayFactory.js';
import { historyHeaderFactory, historyItemFactory } from './historyFactory.js';
import { treatmentsFactory } from './treatmentsFactory.js';

import {
	HistorySorter, HistorySectionSorter, TodaySectionSorter,
	DataDir, addLeadZero, doseRow, getTimeBtnInput,
	createTempFile, handleCalendarSelect, isTodayMedDay,
	datesPassedDiff, removeCssColors
} from './utils.js';

const historyLS = Gio.ListStore.new(HistoryMedication);
const treatmentsLS = Gio.ListStore.new(Medication);

export const DosageWindow = GObject.registerClass({
	GTypeName: 'DosageWindow',
	Template: 'resource:///io/github/diegopvlk/Dosage/ui/window.ui',
	InternalChildren: [
		'todayList', 'historyList', 'treatmentsList', 'treatmentsPage',
		'emptyTodayBox', 'emptyToday', 'emptyHistory', 'emptyTreatments', 
		'allDoneIcon', 'skipBtn', 'entryBtn', 'unselectBtn'
	],
},
class DosageWindow extends Adw.ApplicationWindow {
	constructor(application) {
		super({ application });
		this.#loadSettings();
		this.#checkClockFormat();
		this.#start();
		this.#checkInventory();
		this.#clockTick();
	}

	#loadSettings() {
		const appId = this.get_application().applicationId;
		globalThis.settings = new Gio.Settings({ schemaId: appId });
		settings.bind('window-width', this, 'default-width', Gio.SettingsBindFlags.DEFAULT);
		settings.bind('window-height', this, 'default-height', Gio.SettingsBindFlags.DEFAULT);
	}

	#checkClockFormat() {
		const currentTime = GLib.DateTime.new_now_local();
		const timeFormat = currentTime.format('%X').slice(-2);
		globalThis.clockIs12 = timeFormat === 'AM' || timeFormat === 'PM';
	}
	
	#start() {
		const treatmentsFile = DataDir.get_child('dosage-treatments.json');
		const historyFile = DataDir.get_child('dosage-history.json');

		this._createLoadJsonFile('treatments', treatmentsFile);
		this._createLoadJsonFile('history', historyFile);

		try {
			this._loadTreatments();
			this._loadHistory();
			this._updateItems();
			this._addMissedItems();
			this._updateCycleAndLastUp();
			this._updateJsonFile('treatments', treatmentsLS);
			this._loadToday();
			this._handleSuspension();
			this._scheduleNotifications();
		} catch (err) {
			console.error('Error loading treatments/history/today:', err);
		}
	}

	#checkInventory(notifAction) {
		this._treatmentsPage.set_needs_attention(false);
		this._treatmentsPage.badge_number = 0;

		for (const item of treatmentsLS) {
			const inv = item.info.inventory;
			if (inv.enabled && inv.current <= inv.reminder) {
				this._treatmentsPage.set_needs_attention(true);
				this._treatmentsPage.badge_number += 1;

				if (!this.get_visible() && !notifAction) {
					const [notification, app] = this._getNotification();
					// TRANSLATORS: Notification text for for when the inventory is low
					notification.set_body(_('You have treatments low in stock'));
					app.send_notification('low-stock', notification);	
				}
			}
		}

		// reload-ish of treatments list
		// necessary for updating low stock label
		this._treatmentsList.model = new Gtk.NoSelection({
			model: treatmentsLS,
		});
	}

	#clockTick() {
		let lastDate = new Date().setHours(0, 0, 0, 0);

		const tick = () => {
			const now = new Date().setHours(0, 0, 0, 0);
			// update everything at next midnight
			if (now > lastDate) {
				this._addMissedItems();
				this._updateEverything();
				this._scheduleNotifications();
				lastDate = now;
			}
		}
	
		setInterval(tick, 2500);
	}

	_handleSuspension() {
		const onWakingUp = () => this._scheduleNotifications('sleep');
		this._connection = Gio.bus_get_sync(Gio.BusType.SYSTEM, null)
        this._connection.signal_subscribe(
            'org.freedesktop.login1',
            'org.freedesktop.login1.Manager',
            'PrepareForSleep',
            '/org/freedesktop/login1',
            null,
            Gio.DBusSignalFlags.NONE,
            onWakingUp,
        );
	}

	_createLoadJsonFile(fileType, file) {
		const filePath = file.get_path();
	
		if (!file.query_exists(null)) {
			try {
				this._createNewFile(filePath);
				log(`New ${fileType} file created at: ${filePath}`);
			} catch (err) {
				console.error(`Failed to create new ${fileType} file: ${err}`);
			}
		}

		try {
			this._loadJsonContents(fileType, filePath);
		} catch (err) {
			console.error(`Failed to load ${fileType} contents: ${err}`);
		}
	}

	_createNewFile(filePath) {
		const file = Gio.File.new_for_path(filePath);
		const flags = Gio.FileCreateFlags.NONE;
		const fileStream = file.create(flags, null);

		if (!fileStream) {
			throw new Error('Failed to create the file:', filePath);
		}

		const outputStream = new Gio.DataOutputStream({ base_stream: fileStream });
		outputStream.put_string('{"meds":[]}', null);

		outputStream.close(null);
		fileStream.close(null);
	}

	_loadJsonContents(fileType, filePath) {
		const file = Gio.File.new_for_path(filePath);
		const decoder = new TextDecoder('utf8');

		try {
			let [success, contents, length] = file.load_contents(null);

			if (success) {
				const contentString = decoder.decode(contents);
				if (fileType === 'treatments') {
					this._treatmentsJson = JSON.parse(contentString);
				} else if (fileType === 'history') {
					this._historyJson = JSON.parse(contentString);
				}
			} else {
				log('Failed to read file contents.');
			}
		} catch (err) {
			console.error(`Error reading the file ${fileType}: ${err.message}`);
		}
	}

	_loadTreatments() {
		try {
			if (treatmentsLS.get_n_items() === 0) {
				this._treatmentsJson.meds.forEach(med => {
					treatmentsLS.insert_sorted(
						new Medication({
							// condition is for <= v1.2.0
							name: med.name || med._name,
							unit: med.unit || med._unit,
							info: med.info || med._info,
						}),
						(obj1, obj2) => {
							const name1 = obj1.name;
							const name2 = obj2.name;
							return name1.localeCompare(name2);
						}
					);
				});	
				this._treatmentsList.set_factory(treatmentsFactory);	
				this._treatmentsList.remove_css_class('view');
				this._treatmentsList.add_css_class('background');

				this._treatmentsList.model = new Gtk.NoSelection({
					model: treatmentsLS,
				});
			}
		} catch (err) {
			console.error('Error loading treatments:', err);
		}
	}

	_loadHistory() {
		try {
			if (historyLS.get_n_items() === 0) {
				this._historyJson.meds.forEach(med => {
					historyLS.append(
						new HistoryMedication({
							// condition is for <= v1.2.0
							name: med.name || med._name,
							unit: med.unit || med._unit,
							color: med.color || med._color,
							info: med.info || med._info,
							taken: med.taken || med._taken,
							date: med.date || med._date,
						})
					);
				});
				
				this._sortedHistoryModel = new Gtk.SortListModel({
					model: historyLS,
					section_sorter: new HistorySectionSorter(),
					sorter: new HistorySorter(),
				});

				this._historyList.model = new Gtk.NoSelection({
					model: this._sortedHistoryModel,
				});
	
				this._historyList.remove_css_class('view');
				this._historyList.add_css_class('background');
		
				this._historyList.set_header_factory(historyHeaderFactory);
				this._historyList.set_factory(historyItemFactory);

				historyLS.connect('items-changed', (model, pos, removed, added) => {
					if (added) {
						const itemAdded = model.get_item(pos);
						for (const item of treatmentsLS) {
							const sameItem = 
								item.name === itemAdded.name &&
								item.info.inventory.enabled &&
								itemAdded.taken === 'yes';

							if (sameItem) {
								item.info.inventory.current -= itemAdded.info.dose;
							}		
						}
					}

					if (removed) {
						const itemRmDt = new Date(itemRemoved.date);
						const date = itemRmDt.setHours(0, 0, 0, 0);
						const today = new Date().setHours(0, 0, 0, 0);
					
						if (date === today) {
							for (const item of treatmentsLS) {
								const sameItem = item.name === itemRemoved.name;
								const info = item.info;
					
								if (sameItem) {
									info.dosage.forEach((timeDose) => {
										const td = { ...timeDose, lastTaken: undefined };
										const sameDose =
											JSON.stringify(td) === JSON.stringify(itemRemoved.info);
										
										if (sameDose) timeDose.lastTaken = null;
									});
					
									if (info.inventory.enabled && itemRemoved.taken === 'yes') {
										info.inventory.current += itemRemoved.info.dose;
									}
								}
							}
						}
						this._updateEverything();
						this._scheduleNotifications('removing');
					}				
				});
			}
		} catch (err) {
			console.error('Error loading history:', err)
		}

		this._setEmptyHistLabel();
		this._emptyHistory.ellipsize = Pango.EllipsizeMode.END;
	}

	_loadToday() {
		const todayLS = Gio.ListStore.new(TodayMedication);
		const tempFile = createTempFile('treatments', treatmentsLS);

		tempFile.meds.forEach(med => {
			med.info.dosage.forEach(timeDose => {
				const info = { ...med.info };
				info.dosage = {
					time: [timeDose.time[0], timeDose.time[1]],
					dose: timeDose.dose,
				};
				todayLS.append(
					new TodayMedication({
						name: med.name,
						unit: med.unit,
						info: info,
					})
				);
			});
		})

		this._filterTodayModel = new Gtk.FilterListModel({
			model: todayLS,
			filter: Gtk.CustomFilter.new(item => {
				return isTodayMedDay(
					item,
					this._historyList.model,
				);
			}),
		});

		this._sortedTodayModel = new Gtk.SortListModel({
			model: this._filterTodayModel,
			section_sorter: new TodaySectionSorter(),
		});

		this._todayModel = new Gtk.NoSelection({ model: this._sortedTodayModel });
		this._todayList.model = this._todayModel;

		this._todayList.remove_css_class('view');
		this._todayList.add_css_class('background');

		this._todayList.set_header_factory(todayHeaderFactory);
		this._todayList.set_factory(todayItemFactory);

		this._todayItems = [];

		const noItems = this._sortedTodayModel.get_n_items() === 0;
		const noTreatments = this._treatmentsList.model.get_n_items() === 0;

		this._emptyTreatments.ellipsize = Pango.EllipsizeMode.END;
		this._emptyToday.ellipsize = Pango.EllipsizeMode.END;
		
		this._emptyTreatments.set_visible(noTreatments);

		if (noItems && noTreatments) {
			this._emptyTodayBox.set_visible(true);
			this._emptyToday.set_visible(true);
			this._allDoneIcon.set_visible(false);
			this._emptyToday.label = _('No treatments added yet!');
		} else if (noItems) {
			this._emptyTodayBox.set_visible(true);
			this._allDoneIcon.set_visible(true);
			this._emptyToday.set_visible(true);
			this._emptyToday.label = _('All done for today!');
		} else {
			this._emptyTodayBox.set_visible(false);
			this._allDoneIcon.set_visible(false);
			this._emptyToday.set_visible(false);
		}
	}

	_scheduleNotifications(action) {
		for (const id in this._scheduledItems) {
			clearTimeout(this._scheduledItems[id]);
		}

		this._scheduledItems = {};
		
		const todayLength = this._todayModel.get_n_items();
		
		for (let i = 0; i < todayLength; i++) {
			this._addToBeNotified(this._todayModel.get_item(i), action);
		}		
	}

	_addToBeNotified(item, action) {
		const now = new Date();
		const hours = now.getHours();
		const minutes = now.getMinutes();
		const seconds = now.getSeconds();
		const itemHour = item.info.dosage.time[0];
		const itemMin = item.info.dosage.time[1];

		// milliseconds
		let timeDiff =
			(itemHour - hours) * 3600000 +
			(itemMin - minutes) * 60000 -
			seconds * 1000;

		let pseudoId = JSON.stringify({
			name: item.name, dosage: item.info.dosage,
		});
		// remove accents and special characters
		pseudoId = pseudoId.normalize('NFKD').replace(/[^0-9A-Za-z]/g, '');

		const notify = () => {
			// notifications from the past will be sent again instantly (setTimeout is < 0)
			// when performing some action like saving/adding/updating/removing
			// because it needs to be rescheduled at every action
			// so don't send notifications in this case
			if (action && action != 'sleep' && timeDiff < 0) {
				timeDiff = 0;
				return;
			};

			const [notification, app] = this._getNotification();
			let h = item.info.dosage.time[0];
			let m = item.info.dosage.time[1];
			let period = '';
			
			if (clockIs12) {
				period = ' AM';
				if (h >= 12) period = ' PM';
				if (h > 12) h -= 12;
				if (h === 0) h = 12;
			}

			notification.set_title(item.name);
			notification.set_body(
				`${item.info.dosage.dose} ${item.unit}  •  ` +
					`${addLeadZero(h)}∶${addLeadZero(m)}` + period
			);

			if (settings.get_boolean('confirm-button')) {
				notification.add_button(_('Confirm'), `app.confirm${pseudoId}`);
			}

			if (settings.get_boolean('skip-button')) {
				notification.add_button(_('Skip'), `app.skip${pseudoId}`);
			}

			const confirmAction = new Gio.SimpleAction({
				name: `confirm${pseudoId}`,
			});
			confirmAction.connect('activate', () =>
				this._addNotifItemToHistory(item, 'yes')
			);

			const skipAction = new Gio.SimpleAction({ name: `skip${pseudoId}` });
			skipAction.connect('activate', () =>
				this._addNotifItemToHistory(item, 'no')
			);

			app.add_action(confirmAction);
			app.add_action(skipAction);

			if (settings.get_boolean('sound') && action != 'sleep') {
				const ding = Gio.File.new_for_uri(
					'resource:///io/github/diegopvlk/Dosage/sounds/ding.ogg'
				);
				const mediaFile = Gtk.MediaFile.new_for_file(ding);
				mediaFile.play();
			}

			app.send_notification(pseudoId, notification);
		}
		
		// v1.1.0 only has recurring: boolean
		const recurringEnabled =
			item.info.recurring &&
			item.info.recurring.enabled || item.info.recurring === true;	
			
		if (recurringEnabled) {
			const interval = item.info.recurring.interval || 5;
			const minutes = interval * 60 * 1000;
			const recurringNotify = (pseudoId, timeDiff) => {
				this._scheduledItems[pseudoId] = setTimeout(() => {
					notify();
					recurringNotify(pseudoId, minutes);
				}, timeDiff);
			};

			recurringNotify(pseudoId, timeDiff);
			return;
		}

		this._scheduledItems[pseudoId] = setTimeout(notify, timeDiff);
	}

	_getNotification() {
		const app = this.get_application();
		const notification = new Gio.Notification();
		const openAction = new Gio.SimpleAction({ name: 'open' });

		notification.set_default_action('app.open');
		openAction.connect('activate', () => {
			app.activate();
			this.present();
		});
		app.add_action(openAction);

		const priorityState = settings.get_boolean('priority');
		const priority = priorityState
			? Gio.NotificationPriority.URGENT
			: Gio.NotificationPriority.NORMAL;
		notification.set_priority(priority);
		notification.set_title(_('Dosage'));

		return [notification, app];
	}

	_selectTodayItems(list, position) {
		const model = list.get_model();

		let rowItemPos = 0;
		let currentRow = list.get_first_child();

		while (currentRow) {
			if (currentRow.get_name() === 'GtkListItemWidget') {
				if (position === rowItemPos) {
					const topBox = currentRow.get_first_child();
					const labelsBox = topBox.get_first_child().get_next_sibling();
					const check = labelsBox.get_next_sibling().get_next_sibling();
					const item = model.get_item(position);
					const index = this._todayItems.lastIndexOf(item);

					if (check.get_active() === false) {
						this._todayItems.push(item);
					} else {
						this._todayItems.splice(index, 1);
					}
					
					check.set_active(!check.get_active());
				}
				rowItemPos++;
			}
			currentRow = currentRow.get_next_sibling();
		}

		this._unselectBtn.connect('clicked', () => {
			let currentRow = list.get_first_child();
			
			while (currentRow) {
				if (currentRow.get_name() === 'GtkListItemWidget') {
					const topBox = currentRow.get_first_child();
					const labelsBox = topBox.get_first_child().get_next_sibling();
					const check = labelsBox.get_next_sibling().get_next_sibling();
					check.set_active(false);
				}
				currentRow = currentRow.get_next_sibling();
			}
			this._updateEntryBtn(false);
		});
		
		const hasTodayItems = this._todayItems.length > 0;
		this._updateEntryBtn(hasTodayItems);
	}

	_updateEntryBtn(hasTodayItems) {
		this._entryBtn.label = hasTodayItems ? _('Confirm') : _('One-time entry');
		this._skipBtn.set_visible(hasTodayItems);
		this._unselectBtn.set_visible(hasTodayItems);

		if (hasTodayItems) {
			this._entryBtn.add_css_class('suggested-action');
		} else {
			this._entryBtn.remove_css_class('suggested-action');
			this._todayItems = [];
		}
	}

	_addTodayToHistory(btn) {
		const taken = btn.get_name(); // yes or no

		if (this._todayItems.length > 0) {
			this._todayItems.forEach(item => 
				this._insertItemToHistory(item, taken)
			);

			this._updateEverything();
			this._scheduleNotifications('adding');
		} else {
			// one-time entry
			this._openMedWindow(null, null, true);
		}

		this._updateEntryBtn(false);
	}

	_addNotifItemToHistory(item, taken) {
		const todayLength = this._todayModel.get_n_items();
		// only insert to history if item is not in today list
		for (let i = 0; i < todayLength; i++) {
			if (item === this._todayModel.get_item(i)) {
				this._insertItemToHistory(item, taken);
				this._updateEverything(null, 'notifAction');
				this._scheduleNotifications('adding');
			}
		}	
	}

	_insertItemToHistory(item, taken, missedDate) {
		historyLS.insert(
			0,
			new HistoryMedication({
				name: item.name,
				unit: item.unit,
				color: item.info.color,
				taken: taken,
				info: item.info.dosage,
				date: missedDate || new Date().toISOString(),
			})
		);

		// update lastTaken of treatment dose when confirming/skipping
		if (!missedDate) {	
			for (const item of treatmentsLS) {
				item.info.dosage.forEach(timeDose => {
					const tempObj = { ...timeDose, lastTaken: undefined };
					const treatDose = JSON.stringify(tempObj);

					this._todayItems.forEach(i => {
						const todayDose = JSON.stringify(i.info.dosage);
						if (treatDose === todayDose) {
							timeDose.lastTaken = new Date().toISOString();
						}
					});
				});
			}
		}
	}

	_updateJsonFile(type, listStore) {
		const fileName = `dosage-${type}.json`;
		const file = DataDir.get_child(fileName);
		const tempFile = createTempFile(type, listStore);
		
		const updateFile = () => {
			return new Promise((resolve, reject) => {
				const byteArray = new TextEncoder().encode(JSON.stringify(tempFile));
				file.replace_contents_async(
					GLib.Bytes.new(byteArray),
					null,
					true,
					Gio.FileCreateFlags.REPLACE_DESTINATION,
					null,
					(file, result, userData) => {
						try {
							file.replace_contents_finish(result);
							resolve(`${fileName} updated`);
						} catch (err) {
							console.error(`Update of ${fileName} failed: ${err}`);
							reject(err);
						}
					},
					null
				);
			});
		};

		updateFile()
			.then(result => log(result))
			.catch(err => console.error('Update failed:', err));
	}

	_updateItems() {
		// for compatibility
		for (const item of treatmentsLS) {
			const info = item.info;
			const dur = info.duration;

			// change to int and to parse in ms instead of seconds
			if (typeof dur.start === 'string') {
				dur.start = +dur.start * 1000;
				// add duration.end if doesn't exist
				dur.end = +dur.end * 1000 || dur.start;
			}

			if (!info.lastUpdate) {
				const today = new Date().setHours(0, 0, 0, 0);
				const start = new Date(dur.start).setHours(0, 0, 0, 0);

				info.lastUpdate = start > today ? new Date() : new Date(dur.start);
				info.lastUpdate = info.lastUpdate.toISOString();
			}
		}
	}

	_addMissedItems() {
		let itemsAdded = false;

		const insert = (timeDose, tempItem, nextDate) => {
			if (!timeDose.lastTaken) {
				const nextDt = new Date(nextDate);
				nextDt.setHours(23, 59, 59, 999);
				this._insertItemToHistory(tempItem, 'miss', nextDt.toISOString());
				itemsAdded = true;
			}
		}

		for (const item of treatmentsLS) {
			const info = item.info;
			const today = new Date();
			const nextDate = new Date(item.info.lastUpdate);
			today.setHours(0, 0, 0, 0);
			nextDate.setHours(0, 0, 0, 0);

			let current = info.cycle[2];
			
			while (nextDate < today) {
				const [active, inactive] = info.cycle;
	
				info.dosage.forEach(timeDose => {
					const tempItem = {};
					tempItem.name = item.name;
					tempItem.unit = item.unit;
					tempItem.info = { ...item.info };
					tempItem.info.dosage = {
						time: [timeDose.time[0], timeDose.time[1]],
						dose: timeDose.dose,
					};
					switch (info.frequency) {
						case 'daily':
							insert(timeDose, tempItem, nextDate);
							break;
						case 'specific-days':
							if (info.days.includes(nextDate.getDay())) {
								insert(timeDose, tempItem, nextDate);
							}
							break;
						case 'cycle':
							if (current <= active) {
								insert(timeDose, tempItem, nextDate);
							}
							break;
					}
					// only the first date of confirmed/skipped items doens't get added 
					// so set lastTaken to null after the first loop
					timeDose.lastTaken = null;
				});

				current += 1;
				if (current > active + inactive) current = 1;
				
				nextDate.setDate(nextDate.getDate() + 1);
			}	
		}

		if (itemsAdded) {
			this._updateJsonFile('history', historyLS);
		}

		this._setEmptyHistLabel();
	}

	_updateCycleAndLastUp() {
		for (const item of treatmentsLS) {
			const info = item.info;
			const lastUpdate = new Date(info.lastUpdate);
			const lastUp = lastUpdate.setHours(0, 0, 0, 0);
			const today = new Date().setHours(0, 0, 0, 0);

			if (info.frequency == 'cycle') {
				const datesPassed = datesPassedDiff(lastUpdate, new Date());
				let [active, inactive, current] = info.cycle;

				for (let i = 0; i < datesPassed.length; i++) {
					current += 1;
					if (current > active + inactive) current = 1;
				}

				item.info.cycle[2] = current;
			}

			if (lastUp < today) info.lastUpdate = new Date().toISOString();
		}
	}

	_setEmptyHistLabel() {
		if (historyLS.get_n_items() === 0)
			this._emptyHistory.set_visible(true);
		else
			this._emptyHistory.set_visible(false);
	}

	_updateEverything(skipHistUp, notifAction) {
		if (!skipHistUp) this._updateJsonFile('history', historyLS);
		this._updateCycleAndLastUp();
		this._updateJsonFile('treatments', treatmentsLS);
		this._loadToday();
		this._setEmptyHistLabel();
		this._updateEntryBtn(false);
		this.#checkInventory(notifAction);
	}

	_openMedWindow(list, position, oneTime) {
		const builder = Gtk.Builder.new_from_resource(
			'/io/github/diegopvlk/Dosage/ui/med-window.ui'
		);

		const dateOneEntry = builder.get_object('dateOneEntry');
		const calOneEntry = builder.get_object('calOneEntry');
		const calOneEntryBtn = builder.get_object('calOneEntryBtn');
		const oneTimeMenuRow = builder.get_object('oneTimeMenu').get_parent();
		oneTimeMenuRow.set_visible(false);

		const medWindow = builder.get_object('medWindow');
		medWindow.set_modal(true);
		medWindow.set_transient_for(this);

		const keyController = new Gtk.EventControllerKey();
		keyController.connect('key-pressed', (_, keyval, keycode, state) => {
			if (keyval === Gdk.KEY_Escape) {
				closeWindow();
			}
		});
		medWindow.add_controller(keyController);
		
		const cancelButton = builder.get_object('cancelButton');
		const saveButton = builder.get_object('saveButton');
		const deleteButton = builder.get_object('deleteMedication');

		const medName = builder.get_object('name');
		const medUnit = builder.get_object('unit');
		const medNotes = builder.get_object('notes');

		const dosageColorButton = builder.get_object('dosageColorButton');
		const dosageIconButton = builder.get_object('dosageIconButton');
		const dosageColorBox = builder.get_object('dosageColorBox');
		const dosageIconBox = builder.get_object('dosageIconBox');

		for (const clr of dosageColorBox) {
			clr.connect('clicked', () => {
				removeCssColors(dosageColorButton);
				dosageColorButton.add_css_class(clr.get_name() + '-clr')
				dosageColorButton.name = clr.get_name();
				dosageColorBox.get_parent().get_parent().popdown();
			});
		}
		for (const icn of dosageIconBox) {
			icn.connect('clicked', () => {
				dosageIconButton.set_icon_name(icn.get_icon_name());
				dosageIconBox.get_parent().get_parent().popdown();
			});
		}

		const frequencyMenu = builder.get_object('frequencyMenu');
		const frequencySpecificDays = builder.get_object('frequencySpecificDays');
		const freqChooseDaysLabel = frequencySpecificDays
			.get_first_child()
			.get_first_child()
			.get_first_child();
		freqChooseDaysLabel.ellipsize = Pango.EllipsizeMode.END;

		const frequencyCycle = builder.get_object('frequencyCycle');	
		const cycleActive = builder.get_object('cycleActive');
		const cycleInactive = builder.get_object('cycleInactive');
		const cycleCurrent = builder.get_object('cycleCurrent');

		const dosage = builder.get_object('dosage');
		dosage.set_expanded(true);
		const dosageAddButton = builder.get_object('dosageAddButton');
		const dosageHeader = dosage
			.get_first_child()
			.get_first_child()
			.get_first_child();
		const dosageExpanderBtn = dosageHeader
			.get_first_child()
			.get_last_child();
		dosageHeader.set_activatable(false);
		dosageExpanderBtn.set_visible(false);

		const recurringNotif = builder.get_object('recurringNotif');
		const recurringInterval = builder.get_object('recurringInterval');

		const medInventory = builder.get_object('inventory');
		const medCurrrentInv = builder.get_object('currentInventory');
		const medReminderInv = builder.get_object('reminderInventory');

		const medDuration = builder.get_object('duration');
		const calendarStart = builder.get_object('calendarStart');
		const calendarStartBtn = builder.get_object('calendarStartBtn');
		const calendarEnd = builder.get_object('calendarEnd');
		const calendarEndBtn = builder.get_object('calendarEndBtn');

		calendarStartBtn.label = GLib.DateTime.new_now_local().format('%x');
		calendarEndBtn.label = GLib.DateTime.new_now_local().format('%x');
		  
		handleCalendarSelect(calendarStart, calendarStartBtn);
		handleCalendarSelect(calendarEnd, calendarEndBtn);

		// when opening an existing treatment
		if (list && position >= 0) {
			medWindow.title = _('Edit treatment');
			saveButton.label = _('Save');
			deleteButton.set_visible(true);
			
			const item = list.get_model().get_item(position);
			const info = item.info;

			medName.text = item.name;
			medUnit.text = item.unit;
			medNotes.text = info.notes ? info.notes : '';
			
			for (const clr of dosageColorBox) {
				if (clr.get_name() === info.color) {
					dosageColorButton.add_css_class(info.color + '-clr');
					dosageColorButton.name = clr.get_name();
				}
			}
			for (const icn of dosageIconBox) {
				if (icn.get_icon_name() === info.icon) {
					dosageIconButton.set_icon_name(info.icon);
				}	
			}

			setFreqMenuVisibility(item);

			info.dosage.forEach(timeDose => {
				dosage.add_row(doseRow(timeDose));
			});

			// v1.1.0 only has recurring: boolean
			if (info.recurring) {
				const recurrEnabled = info.recurring.enabled || info.recurring === true;
				recurringNotif.set_enable_expansion(recurrEnabled);
				recurringInterval.value = info.recurring.interval || 5;
			}

			if (info.days && info.days.length !== 0) {
				const specificDaysBox = builder.get_object('specificDaysBox');

				let day = 0;
				for (const btn of specificDaysBox) {
					for (const d of info.days) {
						if (d === day) btn.set_active(true);
					}	
					day++;
				}
			}

			if (info.cycle && info.cycle.length !== 0) {
				const [active, inactive, current] = info.cycle;
				
				cycleActive.value = active;
				cycleInactive.value = inactive;
				cycleCurrent.value = current;
				
				cycleCurrent.adjustment.set_upper(active + inactive);
				cycleCurrent.adjustment.set_upper(active + inactive);
				
				cycleCurrent.adjustment.set_upper(active + inactive);	
				
				frequencyCycle.label = `${active}  ⊷  ${inactive}`;
			}

			if (info.inventory.enabled) {
				medInventory.set_enable_expansion(true);
			}
			medCurrrentInv.value = info.inventory.current;
			medReminderInv.value = info.inventory.reminder;

			if (info.duration.enabled) {
				medDuration.set_enable_expansion(true);

				// this parsing is in seconds
				const localTZ = GLib.TimeZone.new_local();
				const start = GLib.DateTime.new_from_unix_utc(item.info.duration.start / 1000);
				const end = GLib.DateTime.new_from_unix_utc(item.info.duration.end / 1000);
				const startTZ = start.to_timezone(localTZ);
				const endTZ = end.to_timezone(localTZ);

				calendarStart.select_day(startTZ);
				calendarEnd.select_day(endTZ);
			}
		}

		// when activating one-time entry button
		let existingEntry = false;
		if (oneTime) {
			const frequency = builder.get_object('frequency');
			const colorIcon = builder.get_object('colorIcon');
			const oneTimeEntries = builder.get_object('oneTimeEntries');
			const h = new Date().getHours();
			const m = new Date().getMinutes();
			
			dosage.add_row(doseRow({ time: [h, m], dose: 1 }));

			const btnNew = new Gtk.Button({
				css_classes: ['flat'],
				label: _('New'),
			});

			btnNew.remove_css_class('text-button');
			btnNew.get_first_child().set_halign(Gtk.Align.START);
			oneTimeEntries.append(btnNew);

			btnNew.connect('clicked', () => {
				oneTimeEntries.get_parent().get_parent().popdown();
				medName.text = '';
				medUnit.text = _('Pill(s)');
				removeCssColors(dosageColorButton);
				dosageColorButton.name = 'default';
				medName.sensitive = true;
				medUnit.sensitive = true;
				colorIcon.sensitive = true;
				existingEntry = false;
			});

			calOneEntryBtn.label = GLib.DateTime.new_now_local().format('%x');
			handleCalendarSelect(calOneEntry, calOneEntryBtn, true);

			if (this._treatmentsList.model.get_n_items() > 0) {
				oneTimeMenuRow.set_visible(true);
				for (const item of treatmentsLS) {
					const btn = new Gtk.Button({
						css_classes: ['flat', 'one-time-name'],
						label: item.name,
					});
					btn.remove_css_class('text-button');
					btn.get_first_child().set_halign(Gtk.Align.START);

					btn.connect('clicked', () => {
						removeCssColors(dosageColorButton);
						dosageColorButton.add_css_class(item.info.color + '-clr');
						oneTimeEntries.get_parent().get_parent().popdown();

						medName.text = item.name;
						medUnit.text = item.unit;
						dosageColorButton.name = item.info.color;

						medName.sensitive = false;
						medUnit.sensitive = false;
						colorIcon.sensitive = false;
						existingEntry = true;
					});
					oneTimeEntries.append(btn);	
				}
			}

			medWindow.title = _('New entry');
			// TRANSLATORS: Keep it short (button to add one-time entry to history)
			saveButton.label = _('Add to history');
			colorIcon.title = _('Color');
			medWindow.add_css_class('one-time');

			dateOneEntry.set_visible(true);
			medNotes.set_visible(false);
			dosageIconButton.set_visible(false);
			frequency.set_visible(false);
			medDuration.set_visible(false);
			dosageAddButton.get_parent().get_parent().set_visible(false);
			medInventory.set_visible(false);
			recurringNotif.set_visible(false);
		}

		setFreqMenuVisibility();

		cycleActive.connect('output', handleCycle);
		cycleInactive.connect('output', handleCycle);

		let h = 13;
		dosageAddButton.connect('clicked', () => {
			if (h == 24) h = 0;
			dosage.add_row(doseRow({ time: [h++, 30], dose: 1 }));
		});

		const dosageBox = dosage.get_first_child();
		const listBox = dosageBox.get_first_child();
		const revealer = listBox.get_next_sibling();
		const listRows = revealer.get_first_child();
		const firstDoseRow = listRows.get_first_child();

		if (!firstDoseRow) {
			dosage.add_row(doseRow({ time: [12, 30], dose: 1 }));
		}

		globalThis.removeRow = doseRow => {
			const firstDoseRow = listRows.get_first_child();
			const lastDoseRow = listRows.get_last_child();
			
			if (firstDoseRow != lastDoseRow) {
				dosage.remove(doseRow);
			}
		}

		const medWindowBox = builder.get_object('medWindowBox');
		const [medWindowBoxHeight] = medWindowBox.measure(
			Gtk.Orientation.VERTICAL,
			-1
		);
		medWindow.default_height = medWindowBoxHeight + 58;
		
		if (deleteButton.get_visible()) {
			medWindow.default_height -= 12;
		}

		medWindow.present();

		cancelButton.connect('clicked', closeWindow);

		saveButton.connect('clicked', () => {
			const isUpdate = list && position >= 0;

			if (!isValidInput(isUpdate)) {
				return;
			}

			if (oneTime) {
				addItemToHistory(this._historyList, this._sortedHistoryModel);
				this._updateJsonFile('history', historyLS);
			} else {
				addOrUpdateTreatment();
			}

			this._updateEverything('skipHistUp');
			this._scheduleNotifications('saving');
			closeWindow();		
		});

		deleteButton.connect('clicked', () => {
			const dialog = new Adw.MessageDialog({
				// TRANSLATORS: Message for confirmation when deleting an item
				heading: _('Are you sure?'),
				modal: true,
				transient_for: medWindow,
			});

			dialog.add_response('no', _('Cancel'));
			dialog.add_response('yes', _('Delete'));
			dialog.set_response_appearance('yes', Adw.ResponseAppearance.DESTRUCTIVE);
			dialog.present();

			dialog.connect('response', (_self, response) => {
				if (response === 'yes') {
					const it = this._treatmentsList.model.get_item(position);
					const deletePos = treatmentsLS.find(it)[1];
					treatmentsLS.remove(deletePos);
					this._updateEverything('skipHistUp');
					this._scheduleNotifications('deleting');
					closeWindow();
				}
			});
		});

		function addItemToHistory(histList, sortedHist) {
			const calOneEntry = builder.get_object('calOneEntry');
			const dt = +calOneEntry.get_date().format('%s') * 1000;
			const entryDate = new Date(dt);
			const info = getDoses()[0];
			entryDate.setHours(info.time[0]);
			entryDate.setMinutes(info.time[1]);
			historyLS.insert_sorted(
				new HistoryMedication({
					name: medName.text.trim(),
					unit: medUnit.text.trim(),
					color: dosageColorButton.get_name(),
					taken: 'yes',
					info: info,
					date: entryDate.toISOString(),
				}),
				(obj1, obj2) => {
					return obj1.date > obj2.date ? -1 : 0;
				}
			);

			// reload-ish of history, so the item don't get inserted 
			// on a separate section (with the same day) 
			// when the time is less than the first one of same section
			histList.model = new Gtk.NoSelection({
				model: sortedHist,
			});
		}

		function addOrUpdateTreatment() {
			const isUpdate = list && position >= 0;
			const today = new GLib.DateTime;

			let days = [];
			let doses = [];
			let cycle = [];
			let invEnabled = false;
			let durEnabled = false;
			let name, unit, notes, color, freq, icon, recurring, lastUpdate,
				inventory, current, reminder, duration, start, end;

			if (medInventory.get_enable_expansion()) {
				invEnabled = true;
			}

			if (medDuration.get_enable_expansion()) {
				durEnabled = true;
				start = +calendarStart.get_date().format('%s') * 1000;
				end = +calendarEnd.get_date().format('%s') * 1000;
			} else {
				start = +today.format('%s') * 1000;
				end = start;
			}

			name = medName.text.trim(),
			unit = medUnit.text.trim(),
			notes = medNotes.text.trim(),
			days = getSpecificDays();
			doses = getDoses();
			recurring = {};
			recurring.enabled = recurringNotif.get_enable_expansion();
			recurring.interval = recurringInterval.get_value();
			cycle[0] = cycleActive.adjustment.value;
			cycle[1] = cycleInactive.adjustment.value;
			cycle[2] = cycleCurrent.adjustment.value;
			color = dosageColorButton.get_name();
			icon = dosageIconButton.get_icon_name();
			current = medCurrrentInv.value;
			reminder = medReminderInv.value;
			inventory = { enabled: invEnabled, current: current, reminder: reminder };
			duration = { enabled: durEnabled, start: start, end: end };
			lastUpdate = new Date().toISOString();

			if (frequencyMenu.get_selected() === 0) freq = 'daily';
			if (frequencyMenu.get_selected() === 1) freq = 'specific-days';
			if (frequencyMenu.get_selected() === 2) freq = 'cycle';
			if (frequencyMenu.get_selected() === 3) freq = 'when-needed';

			doses.sort((obj1, obj2) => {
				const [h1, m1] = obj1.time;
				const [h2, m2] = obj2.time;
				const hm1 = `${addLeadZero(h1)}${addLeadZero(m1)}`;
				const hm2 = `${addLeadZero(h2)}${addLeadZero(m2)}`;
				return hm1 === hm2 ? 0 : hm1 > hm2 ? 1 : -1;
			});

			if (isUpdate) {
				const item = list.get_model().get_item(position);
				doses = doses.map((dose, idx) => {
					return {
						time: dose.time,
						dose: dose.dose,
						lastTaken: item.info.dosage[idx]?.lastTaken || null,
					};
				});
				treatmentsLS.remove(position);
			}

			treatmentsLS.insert_sorted(
				new Medication({
					name: name,
					unit: unit,
					info: {
						notes: notes,
						frequency: freq,
						color: color,
						icon: icon,
						days: days,
						cycle: cycle,
						dosage: doses,
						recurring: recurring,
						inventory: inventory,
						duration: duration,
						lastUpdate: lastUpdate,
					},
				}),
				(obj1, obj2) => {
					const name1 = obj1.name;
					const name2 = obj2.name;
					return name1.localeCompare(name2);
				}
			);
		}

		function getDoses() {
			const doses = [];
			let currentDoseRow = listRows.get_first_child();

			while (currentDoseRow) {
				const [hours, minutes] = getTimeBtnInput(currentDoseRow);
				const ds = {
					time: [hours, minutes],
					dose: currentDoseRow.get_value(),
				};
				doses.push(ds);
				currentDoseRow = currentDoseRow.get_next_sibling();
			}
			return doses;
		}

		function getSpecificDays() {
			const days = [];
			const specificDaysBox = builder.get_object('specificDaysBox');

			let day = 0;
			for (const button of specificDaysBox) {
				if (button.get_active()) {
					if (!days.includes(day)) {
						days.push(day)
					}	
				};
				day++;
			}
			return days;
		}

		function handleCycle() {
			const sum = cycleActive.value + cycleInactive.value;
			frequencyCycle.label = cycleActive.value + '  ⊷  ' + cycleInactive.value;
			cycleCurrent.adjustment.set_upper(sum);
			if (cycleCurrent.adjustment.value > sum) {
				cycleCurrent.adjustment.value = sum;
			}		
		}

		function setFreqMenuVisibility(item) {
			frequencyMenu.connect('notify::selected-item', () => {
				const selectedItemPos = frequencyMenu.get_selected();

				frequencySpecificDays.set_visible(selectedItemPos === 1);
				frequencyCycle.set_visible(selectedItemPos === 2);

				if (selectedItemPos != 3) {
					dosage.set_visible(true);
					medDuration.set_visible(true);
					recurringNotif.set_visible(true);
					return;
				}
				
				// if when-needed is selected, hide the dosage, duration and recurring rows
				dosage.set_visible(false);
				medDuration.set_visible(false);
				recurringNotif.set_visible(false);
			});

			if (item) {
				const freq = item.info.frequency;
				if (freq === 'daily') frequencyMenu.set_selected(0);
				if (freq === 'specific-days') frequencyMenu.set_selected(1);
				if (freq === 'cycle') frequencyMenu.set_selected(2);
				if (freq === 'when-needed') frequencyMenu.set_selected(3);
			}
		}

		function isValidInput(isUpdate) {
			if (existingEntry) return true;

			const toastOverlay = builder.get_object('toastOverlay');
			medName.connect('changed', name => name.remove_css_class('error'));
			medUnit.connect('changed', unit => unit.remove_css_class('error'));
			
			const emptyName = medName.text.trim() == '';
			const emptyUnit = medUnit.text.trim() == '';

			if (emptyName) {
				toastOverlay.add_toast(new Adw.Toast({ title: _('Empty name') }));
				medName.add_css_class('error');
				return;
			} else if (emptyUnit) {
				toastOverlay.add_toast(new Adw.Toast({ title: _('Empty unit') }));
				medUnit.add_css_class('error');
				return;
			}

			if (frequencySpecificDays.get_visible() && getSpecificDays().length == 0) {
				toastOverlay.add_toast(new Adw.Toast({ title: _('Choose at least one day') }));
				return;
			}

			for (const it of treatmentsLS) {
				if (isUpdate) {
					const item = list.get_model().get_item(position);
					if (it === item) continue;
				}
				if (it.name.toLowerCase() === medName.text.trim().toLowerCase()) {
					toastOverlay.add_toast(new Adw.Toast({ title: _('Name already exists') }));
					medName.add_css_class('error');
					return;
				}
			}

			let currentDoseRow = listRows.get_first_child();
			const rows = [];

			while (currentDoseRow) {
				const [hours, minutes, ampm, timeBtn] = getTimeBtnInput(currentDoseRow);
				const time = String([hours, minutes])

				if (rows.includes(time)) {
					toastOverlay.add_toast(new Adw.Toast({ title: _('Duplicated time') }));
					(async function() {
						timeBtn.add_css_class('time-error');
						ampm.add_css_class('time-error');
						await new Promise(res => setTimeout(res, 1400));
						timeBtn.remove_css_class('time-error');
						ampm.remove_css_class('time-error');
					})();
					return;
				} else {
					rows.push(time);
				}

				currentDoseRow = currentDoseRow.get_next_sibling();
			}
			return true;
		}

		function closeWindow() {
			medWindow.destroy();
		}
	}
});
