/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

/* HACK
 *
 * NetworkManager interfaces have their own PropertiesChanged signals,
 * so we catch them here and tell the interfaces to update their
 * values.
 *
 * Unfortunatly, o.f.NM.Device doesn't have a PropertiesChanged
 * signal.  Instead, the specialized interfaces like
 * o.f.NM.Device.Wired do double duty: Their PropertiesChanged signals
 * contain change notifications for both themselves and the
 * o.f.NM.Device properties.
 *
 * We 'solve' this here by merging the properties of all interfaces
 * for a given object.
 *
 * https://bugzilla.gnome.org/show_bug.cgi?id=729826
 */

function NetworkManagerModel(address) {
    var self = this;

    var client = cockpit.dbus(address,
                              { 'service': "org.freedesktop.NetworkManager",
                                'object-paths': [ "/org/freedesktop/NetworkManager" ],
                                'protocol': "dbus-json1"
                              });

    var objects = { };

    self.devices = [ ];

    function get_object(val) {
        if (val == "/")
            return null;
        if (!objects[val])
            objects[val] = { };
        return objects[val];
    }

    function toDec(n) {
        return n.toString(10);
    }

    function toHex(n) {
        var x = n.toString(16);
        while (x.length < 2)
            x = '0' + x;
        return x;
    }

    function bytes_from_nm32(num) {
        var bytes = [], i;
        if (client.byteorder == "be") {
            for (i = 3; i >= 0; i--) {
                bytes[i] = num & 0xFF;
                num = num >>> 8;
            }
        } else {
            for (i = 0; i < 4; i++) {
                bytes[i] = num & 0xFF;
                num = num >>> 8;
            }
        }
        return bytes;
    }

    function bytes_to_nm32(bytes) {
        var num = 0, i;
        if (client.byteorder == "be") {
            for (i = 0; i < 4; i++) {
                num = 256*num + bytes[i];
            }
        } else {
            for (i = 3; i >= 0; i--) {
                num = 256*num + bytes[i];
            }
        }
        return num;
    }

    function parse_ipv4(ip) {
        var parts = ip.split('.');
        if (parts.length == 4)
            return parts.map(function(s) { return parseInt(s, 10); });
        else
            return [ 0, 0, 0, 0 ];
    }

    function ip4_from_nm(addr) {
        return [ bytes_from_nm32(addr[0]).map(toDec).join('.'),
                 addr[1],
                 bytes_from_nm32(addr[2]).map(toDec).join('.')
               ];
    }

    function ip4_to_nm(addr) {
        return [ bytes_to_nm32(parse_ipv4(addr[0])),
                 parseInt(addr[1], 10),
                 bytes_to_nm32(parse_ipv4(addr[2]))
               ];
    }

    function ip6_from_nm(addr) {
        return [ addr[0].map(toHex).join(':'),
                 addr[1],
                 addr[2].map(toHex).join(':')
               ];
    }

    function ip6_to_nm(addr) {
        // XXX
        return [ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 ];
    }


    function settings_from_nm(settings) {
        var result = $.extend(true, {}, settings);
        if (result.ipv4)
            result.ipv4.addresses = (result.ipv4.addresses || []).map(ip4_from_nm);
        if (result.ipv6)
            result.ipv6.addresses = (result.ipv6.addresses || []).map(ip6_from_nm);
        return result;
    }

    function settings_to_nm(settings) {
        var result = $.extend(true, {}, settings);
        if (result.ipv4)
            result.ipv4.addresses = new DBusValue('aau', (result.ipv4.addresses || []).map(ip4_to_nm));
        if (result.ipv6)
            result.ipv6.addresses = (result.ipv6.addresses || []).map(ip6_to_nm);
        console.log("S", JSON.stringify(result));
        return result;
    }

    function device_state_to_text(state) {
        switch (state) {
            // NM_DEVICE_STATE_UNKNOWN
        case 0: return "?";
            // NM_DEVICE_STATE_UNMANAGED
            case 10: return "";
            // NM_DEVICE_STATE_UNAVAILABLE
        case 20: return _("Not available");
            // NM_DEVICE_STATE_DISCONNECTED
        case 30: return _("Disconnected");
            // NM_DEVICE_STATE_PREPARE
        case 40: return _("Preparing");
            // NM_DEVICE_STATE_CONFIG
        case 50: return _("Configuring");
            // NM_DEVICE_STATE_NEED_AUTH
        case 60: return _("Authenticating");
            // NM_DEVICE_STATE_IP_CONFIG
        case 70: return _("Configuring IP");
            // NM_DEVICE_STATE_IP_CHECK
        case 80: return _("Checking IP");
            // NM_DEVICE_STATE_SECONDARIES
        case 90: return _("Waiting");
            // NM_DEVICE_STATE_ACTIVATED
        case 100: return _("Active");
            // NM_DEVICE_STATE_DEACTIVATING
        case 110: return _("Deactivating");
            // NM_DEVICE_STATE_FAILED
        case 120: return _("Failed");
        default: return "";
        }
    }

    function model_properties_changed (path, iface, props) {
        var obj = objects[path];
        if (!obj)
            obj = { };
        if (iface == "org.freedesktop.NetworkManager") {
            if (props.Devices)    obj.Devices = (props.Devices || []).map(get_object);
        } else if (iface == "org.freedesktop.NetworkManager.Device" ||
                   iface.startsWith("org.freedesktop.NetworkManager.Device.")) {
            if (props.DeviceType) obj.DeviceType = props.DeviceType;
            if (props.Interface)  obj.Interface = props.Interface;
            if (props.Ip4Config)  obj.Ip4Config = get_object(props.Ip4Config);
            if (props.Ip6Config)  obj.Ip6Config = get_object(props.Ip6Config);
            if (props.State)      obj.State = device_state_to_text(props.State);
            if (props.HwAddress)  obj.HwAddress = props.HwAddress;
            if (props.AvailableConnections)  obj.AvailableConnections = props.AvailableConnections.map(get_object);
            if (props.Udi)        refresh_udev (path, props.Udi);
            if (props.IdVendor)   obj.IdVendor = props.IdVendor;
            if (props.IdModel)    obj.IdModel = props.IdModel;
            if (props.Driver)     obj.Driver = props.Driver;
        } else if (iface == "org.freedesktop.NetworkManager.IP4Config") {
            if (props.Addresses)  obj.Addresses = props.Addresses.map(ip4_from_nm);
        } else if (iface == "org.freedesktop.NetworkManager.IP6Config") {
            if (props.Addresses)  obj.Addresses = props.Addresses.map(ip6_from_nm);
        } else if (iface == "org.freedesktop.NetworkManager.Settings.Connection") {
            if (props.Unsaved)    obj.Unsaved = props.Unsaved;
            if (props.Settings)   obj.Settings = settings_from_nm(props.Settings);
            if (!obj.update) {
                obj.update = function (settings) {
                    var dfd = new $.Deferred();
                    // XXX - validate
                    var nm_settings = settings_to_nm(settings);
                    client.get(path, iface).call('Update', nm_settings,
                                                 function (error) {
                                                     if (error) {
                                                         export_model();
                                                         cockpit_show_unexpected_error(error);
                                                         dfd.reject(error);
                                                     } else
                                                         dfd.resolve();
                                                 });
                    return dfd.promise();
                };
            }
        }
        objects[path] = obj;
        export_model();
    }

    function model_removed (path) {
        delete objects[path];
    }

    var changed_pending;

    function export_model() {
        var manager = objects["/org/freedesktop/NetworkManager"];
        self.devices = (manager && manager.Devices) || [];

        if (!changed_pending) {
            changed_pending = true;
            setTimeout(function () { changed_pending = false; $(self).trigger('changed'); }, 0);
        }
    }

    function refresh_all_devices() {
        var path;
        for (path in objects) {
            if (path.startsWith("/org/freedesktop/NetworkManager/Devices/")) {
                (function (path) {
                    var p = client.get(path, "org.freedesktop.DBus.Properties");
                    p.call('GetAll', "org.freedesktop.NetworkManager.Device",
                           function (error, result) {
                               if (!error) {
                                   model_properties_changed(path, "org.freedesktop.NetworkManager.Device", result);
                               }
                           });
                })(path);
            }
        }
    }

    function refresh_settings(iface) {
        iface.call('GetSettings', function (error, result) {
            if (result)
                model_properties_changed(iface.getObject().objectPath, iface._iface_name,
                                         { Settings: result });
        });
    }

    function refresh_udev(path, sysfs_path) {
        cockpit.spawn(["/usr/bin/udevadm", "info", sysfs_path], { host: address }).
            done(function(res) {
                var props = { };
                function snarf_prop(line, env, prop) {
                    var prefix = "E: " + env + "=";
                    if (line.startsWith(prefix)) {
                        props[prop] = line.substr(prefix.length);
                    }
                }
                res.split('\n').forEach(function(line) {
                    snarf_prop(line, "ID_MODEL_FROM_DATABASE", "IdModel");
                    snarf_prop(line, "ID_VENDOR_FROM_DATABASE", "IdVendor");
                });
                console.log(props);
                model_properties_changed(path, "org.freedesktop.NetworkManager.Device", props);
            }).
            fail(function(ex) {
                console.warn(ex);
            });
    }

    function object_added (event, object) {
        for (var iface in object._ifaces)
            interface_added (event, object, object._ifaces[iface]);
    }

    function object_removed (event, object) {
        for (var iface in object._ifaces)
            interface_removed (event, object, object._ifaces[iface]);
    }

    function interface_added (event, object, iface) {
        var path = object.objectPath;
        model_properties_changed (path, iface._iface_name, iface);
        if (iface._iface_name == "org.freedesktop.NetworkManager.Settings.Connection")
            refresh_settings(iface);
    }

    function interface_removed (event, object, iface) {
        var path = object.objectPath;
        model_removed (path);
    }

    function signal_emitted (event, iface, signal, args) {
        if (signal == "PropertiesChanged") {
            var path = iface.getObject().objectPath;
            model_properties_changed (path, iface._iface_name, args[0]);
        } else if (signal == "Updated") {
            refresh_settings(iface);

            /* HACK
             *
             * Some versions of NetworkManager don't always send
             * PropertyChanged notifications about the
             * o.f.NM.Device.Ip4Config property.
             *
             * https://bugzilla.gnome.org/show_bug.cgi?id=729828
             */
            refresh_all_devices();
        }
    }

    $(client).on("objectAdded", object_added);
    $(client).on("objectRemoved", object_removed);
    $(client).on("interfaceAdded", interface_added);
    $(client).on("interfaceRemoved", interface_removed);
    $(client).on("signalEmitted", signal_emitted);

    self.destroy = function destroy() {
        $(client).off("objectAdded", object_added);
        $(client).off("objectRemoved", object_removed);
        $(client).off("interfaceAdded", interface_added);
        $(client).off("interfaceRemoved", interface_removed);
        $(client).off("signalEmitted", signal_emitted);
        client.release();
    };

    self.find_device = function find_device(iface) {
        for (var i = 0; i < self.devices.length; i++) {
            if (self.devices[i].Interface == iface)
                return self.devices[i];
        }
        return null;
    };

    client.getObjectsFrom("/").forEach(function (obj) { object_added (null, obj); });

    return self;
}

PageNetworking.prototype = {
    _init: function () {
        this.id = "networking";
    },

    getTitle: function() {
        return C_("page-title", "Networking");
    },

    enter: function () {
        this.address = cockpit_get_page_param('machine', 'server') || "localhost";
        this.model = new NetworkManagerModel(this.address);
        $(this.model).on('changed.network-interface', $.proxy(this, "update_devices"));
        this.update_devices();
    },

    show: function() {
    },

    leave: function() {
        $(this.model).off(".network-interface");
        this.model.destroy();
        this.model = null;
    },

    update_devices: function() {
        var self = this;
        var tbody;

        tbody = $('#networking-interfaces tbody');
        tbody.empty();
        self.model.devices.forEach(function (dev) {
            if (!dev)
                return;

            // Skip loopback
            if (dev.DeviceType == 14)
                return;

            var addresses = [ ];

            var ip4config = dev.Ip4Config;
            if (ip4config && ip4config.Addresses) {
                ip4config.Addresses.forEach(function (a) {
                    addresses.push(a[0] + "/" + a[1]);
                });
            }

            var ip6config = dev.Ip6Config;
            if (ip6config && ip6config.Addresses) {
                ip6config.Addresses.forEach(function (a) {
                    addresses.push(a[0] + "/" + a[1]);
                });
            }

            tbody.append($('<tr>').
                         append($('<td>').text(dev.Interface),
                                $('<td>').text(addresses.join(", ")),
                                $('<td>').text(dev.HwAddress),
                                $('<td>').text(dev.State)).
                         click(function () { cockpit_go_down ({ page: 'network-interface',
                                                                dev: dev.Interface
                                                              });
                                           }));
        });
    }

};

function PageNetworking() {
    this._init();
}

cockpit_pages.push(new PageNetworking());

PageNetworkInterface.prototype = {
    _init: function () {
        this.id = "network-interface";
        this.connection_mods = { };
    },

    getTitle: function() {
        return C_("page-title", "Network Interface");
    },

    enter: function () {
        var self = this;

        self.address = cockpit_get_page_param('machine', 'server') || "localhost";
        self.model = new NetworkManagerModel(self.address);
        $(self.model).on('changed.network-interface', $.proxy(self, "update"));

        self.update();
    },

    show: function() {
    },

    leave: function() {
        $(this.model).off(".network-interface");
        this.model.destroy();
        this.model = null;
    },

    update: function() {
        var self = this;

        var $hw = $('#network-interface-hw');
        var $connections = $('#network-interface-connections');

        $hw.empty();
        $connections.empty();

        var dev = self.model.find_device(cockpit_get_page_param('dev'));
        if (!dev)
            return;

        $hw.append($('<table class="table">').
                   append($('<tr>').
                          append($('<td>').text(dev.Driver),
                                 $('<td>').text(dev.IdVendor),
                                 $('<td>').text(dev.IdModel),
                                 $('<td>').text(dev.HwAddress))));

        function render_connection(con) {

            if (!con || !con.Settings)
                return [ ];

            var mods = self.connection_mods[con.Settings.connection.uuid];
            if (!mods) {
                mods = { };
                self.connection_mods[con.Settings.connection.uuid] = mods;
            }

            var settings = $.extend(true, {}, con.Settings, mods);

            var mod_box;

            function start_modify_settings(first, second) {
                mods[first] = mods[first] || { };
                mods[first][second] = settings[first][second];
            }

            function finish_modify_settings() {
                settings = $.extend(true, {}, con.Settings, mods);
                $(mod_box).text(JSON.stringify(mods));
            }

            function modify_settings(first, second, val) {
                start_modify_settings(first, second);
                mods[first][second] = val;
                finish_modify_settings();
            }

            function apply_settings() {
                console.log(JSON.stringify(settings));
                con.update(settings).
                    done(function () {
                        mods = { };
                        self.connection_mods[con.Settings.connection.uuid] = mods;
                    });
            }

            function set_default(first, second, def) {
                if (settings[first] === undefined)
                    settings[first] = { };
                if (settings[first][second] === undefined)
                    settings[first][second] = def;
            }

            function checkbox(first, second, def) {
                set_default(first, second, def);
                return ($('<input type="checkbox">').
                        prop('checked', settings[first][second]).
                        change(function (event) {
                            modify_settings(first, second, $(event.target).prop('checked'));
                        }));
            }

            function textbox(first, second, def) {
                set_default(first, second, def);
                return ($('<input>').
                        val(settings[first][second]).
                        change(function (event) {
                            modify_settings(first, second, $(event.target).val());
                        }));
            }

            function choicebox(first, second, choices, def) {
                set_default(first, second, def);
                var btn = cockpit_select_btn(function (choice) {
                                                 modify_settings(first, second, choice);
                                             },
                                             choices);
                cockpit_select_btn_select(btn, settings[first][second]);
                return btn;
            }

            function addr4box(first, second) {
                set_default(first, second, []);

                function add() {
                    return function() {
                        modify_settings(first, second, settings[first][second].concat([[ "", 24, "" ]]));
                        self.update();
                    };
                }

                function remove(index) {
                    return function () {
                        start_modify_settings(first, second);
                        mods[first][second].splice(index,1);
                        finish_modify_settings();
                        self.update();
                    };
                }

                function change(index) {
                    return function (event) {
                        var div = $(event.target).parent('div');
                        var addr = [ $(div).find("input:nth-child(1)").val(),
                                     $(div).find("input:nth-child(2)").val(),
                                     $(div).find("input:nth-child(3)").val()
                                   ];
                        start_modify_settings(first, second);
                        mods[first][second][index] = addr;
                        finish_modify_settings();
                        self.update();
                    };
                }

                return ($('<div>').
                        append($('<button class="btn btn-default">').
                               text(_("Add")).
                               click(add()),
                               settings[first][second].map(function (a, i) {
                                   return ($('<div>').
                                           append($('<input>').val(a[0]).change(change(i)),
                                                  $('<input>').val(a[1]).change(change(i)),
                                                  $('<input>').val(a[2]).change(change(i)),
                                                  $('<button>').
                                                  text(_("X")).
                                                  click(remove(i))));
                               })));
            }

            function render_connection_settings() {
                return ($('<table class="cockpit-form-table">').
                        append($('<tr>').
                               append($('<td class="header">').text(_("Connection"))),
                               $('<tr>').
                               append($('<td>').text(_("Connect automatically")),
                                      $('<td>').append(checkbox("connection", "autoconnect", true)))));
            }

            function render_ipv4_settings() {
                var method_choices = [
                    { choice: 'auto',         title: _("Automatic (DHCP)") },
                    { choice : 'link-local',  title: _("Link local") },
                    { choice: 'manual',       title: _("Manual") },
                    { choice: 'shared',       title: _("Shared") },
                    { choice: 'disabled',     title: _("Disabled") }
                ];

                return ($('<table class="cockpit-form-table">').
                        append($('<tr>').
                               append($('<td class="header">').text(_("IPv4"))),
                               $('<tr>').
                               append($('<td>').text(_("Method")),
                                      $('<td>').append(choicebox("ipv4", "method", method_choices, "disabled"))),
                               $('<tr>').
                               append($('<td>').text(_("Addresses")),
                                      $('<td>').append(addr4box("ipv4", "addresses")))));
            }

            function render_ipv6_settings(ipv4) {
                var method_choices = [
                    { choice: 'auto',         title: _("Automatic") },
                    { choice: 'dhcp',         title: _("Automatic (DHCP only)") },
                    { choice : 'link-local',  title: _("Link local") },
                    { choice: 'manual',       title: _("Manual") },
                    { choice: 'ignore',       title: _("Ignore") }
                ];

                return ($('<table class="cockpit-form-table">').
                        append($('<tr>').
                               append($('<td class="header">').text(_("IPv6"))),
                               $('<tr>').
                               append($('<td>').text(_("Method")),
                                      $('<td>').append(choicebox("ipv6", "method", method_choices, "ignore")))));
            }


            if (con && con.Settings && con.Settings.connection)
                return ($('<div class="panel panel-default">').
                        append($('<div class="panel-heading">').
                               append($('<span>').text(con.Settings.connection.id),
                                      $('<button class="btn btn-default" style="display:inline;float:right">').
                                      text("Apply").
                                      click(apply_settings)),
                               $('<div class="panel-body">').
                               append(render_connection_settings(con.Settings.connection),
                                      $('<hr>'),
                                      render_ipv4_settings(),
                                      $('<hr>'),
                                      render_ipv6_settings(),
                                      $('<hr>'),
                                      $('<div>').text(JSON.stringify(con.Settings)),
                                      mod_box = $('<div>').text(JSON.stringify(mods)))));

            else
                return [ ];
        }

        (dev.AvailableConnections || []).forEach(function (con) {
            $connections.append(render_connection(con));
        });
    }

};

function PageNetworkInterface() {
    this._init();
}

cockpit_pages.push(new PageNetworkInterface());
