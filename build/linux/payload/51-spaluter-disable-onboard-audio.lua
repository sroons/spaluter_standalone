-- Spaluter Desktop: keep the unused onboard audio cards (the bcm2835
-- headphone jack and both vc4 HDMI outputs) out of the PipeWire graph on the
-- pisound build, so the pisound is the only ALSA card WirePlumber creates
-- nodes for. Installed by the .deb postinst to
-- /etc/wireplumber/main.lua.d/ (Pi/ARM installs only).
--
-- The pisound is alsa_card.platform-soc_sound and is never matched here.
-- Patchbox's own set-pisound-default.service already switches these cards'
-- profiles off after login; this rule means they never get nodes at all.
if alsa_monitor ~= nil and alsa_monitor.rules ~= nil then
  table.insert(alsa_monitor.rules, {
    matches = {
      {
        { "device.name", "matches", "alsa_card.platform-fe00b840.mailbox" },
      },
      {
        { "device.name", "matches", "alsa_card.platform-fef0*.hdmi" },
      },
    },
    apply_properties = {
      ["device.disabled"] = true,
    },
  })
end
