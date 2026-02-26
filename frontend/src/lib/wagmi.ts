import { createConfig, http } from "wagmi";
import { baseSepolia, sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const chains = [sepolia, baseSepolia] as const;

export const wagmiConfig = createConfig({
  chains,
  connectors: [injected()],
  transports: {
    [sepolia.id]: http(),
    [baseSepolia.id]: http(),
  },
  ssr: true,
});
