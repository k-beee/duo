import sys

def main():
    print("====================================================")
    print(" DuoArena Intelligent Contract - Deployment Assistant")
    print("====================================================\n")
    print("To deploy the contract to GenLayer Studionet, run the following commands:")
    print("1. Install GenLayer CLI (if not already installed):")
    print("   npm install -g genlayer\n")
    print("2. Set the target network to Studionet:")
    print("   genlayer network set studionet\n")
    print("3. Create a developer deployment account:")
    print("   genlayer account create --name deployer --password <YOUR_PASSWORD>\n")
    print("4. Unlock the account:")
    print("   genlayer account unlock --password <YOUR_PASSWORD>\n")
    print("5. Deploy the contract:")
    print("   genlayer deploy --contract contracts/duo_arena.py\n")
    print("After successful deployment, copy the contract address and update")
    print("the CONTRACT_ADDRESS variable in 'frontend/src/lib/genlayer.ts' or")
    print("set the NEXT_PUBLIC_CONTRACT_ADDRESS environment variable.")
    print("====================================================")

if __name__ == '__main__':
    main()
