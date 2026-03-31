declare module 'konsta/config' {
  import type { Config } from 'tailwindcss'
  function konstaConfig(config: Partial<Config>): Partial<Config>
  export default konstaConfig
}
