import { ExternalLink } from 'lucide-react'
import { api } from '../../api'
import { Button } from '../../components/Button'
import { SchemaSetting } from '../../components/SchemaSetting'
import { TextField } from '../../components/TextField'
import { useSettings, useSettingsValue } from '../../stores/settings'
import { Section } from './Settings'

export function AchievementsTab() {
  const s = useSettingsValue()
  const update = useSettings((st) => st.update)
  const ra = s.retroAchievements
  return (
    <>
      <p className="settings-body__intro">Earn achievements in classic games through RetroAchievements.org. Unlocks pop up in-game in RetroArch and supported emulators.</p>
      <Section>
        <SchemaSetting path="retroAchievements.enabled" />
        <TextField title="Username" value={ra.username} placeholder="Your RetroAchievements name" onCommit={(v) => void update({ retroAchievements: { username: v.trim() } })} />
        <TextField title="Password or API token" password value={ra.password} placeholder="Stored locally" onCommit={(v) => void update({ retroAchievements: { password: v } })} />
        <SchemaSetting path="retroAchievements.hardcore" disabled={!ra.enabled} />
      </Section>
      <div className="button-row">
        <Button icon={ExternalLink} variant="quiet" onPress={() => void api.system.openExternal('https://retroachievements.org/createaccount.php')}>
          Create an account
        </Button>
      </div>
    </>
  )
}
