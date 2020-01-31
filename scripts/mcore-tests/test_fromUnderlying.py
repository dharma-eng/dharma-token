''' Tests that fromUnderlying of all nonzero can not return a zero 
Run it like this

        python scripts/mcore-tests/test_fromUnderlying.py

This uses a shell contract to access internal `fromUnderlying`
tests/ManticoreTest.sol:
pragma solidity 0.5.11;
import "../token/DharmaDaiImplementationV0.sol";

contract ManticoreTest is DharmaDaiImplementationV0{

  function fromUnderlying(
    uint256 underlying, uint256 exchangeRate, bool roundUp
  ) external returns (uint256 amount) {
     amount = _fromUnderlying(underlying, exchangeRate, roundUp);
    }
}

'''

from manticore import config
from manticore.ethereum import ManticoreEVM, ABI
m = ManticoreEVM()
config.get_group("smt").timeout=3600
config.get_group("evm").oog = "ignore"
controller = m.create_account(balance=1 * 10**18)
contract = m.solidity_create_contract('.', 
                                   contract_name='ManticoreTest',
                                   owner=controller,
                                   compile_args={'ignore_compile':True})


underlying = m.make_symbolic_value()
exchangeRate = m.make_symbolic_value()
roundUp = m.make_symbolic_value(8)
#All arguments nonzero
m.constrain(underlying != 0)
m.constrain(exchangeRate != 0)
#roundUp true
m.constrain(roundUp != 0)

#Execute the transaction
contract.fromUnderlying(underlying, exchangeRate, roundUp)
#You can replace that with concrete values to reproduce it if a bug is found
#contract.fromUnderlying(1,14474011154664523624477350999513853985339507749031138909263555379280740351999,0)

#Now Check that the result is nonzero in all possible states
for st in m.ready_states:
    assert(len(st.platform.human_transactions) == 2), "All ready states must have executed 2 human transactions"    
    assert(st.platform.human_transactions[-1].result == "RETURN"), "All ready states must have a successful last tx"
    world = st.platform
    tx = st.platform.human_transactions[-1]

    #The result of the last successful tx
    tx_ret = ABI.deserialize("uint256", tx.return_data)
    if st.can_be_true(tx_ret == 0):
        st.constrain(tx_ret == 0)
        print (f"Bug found. fromUnderlying of nonzero underlying and exchangeRate, returns a zero")
        print (f"fromUnderlying{tuple(st.solve_one_n(underlying, exchangeRate, roundUp, constrain=True))} -> {st.solve_one(tx_ret)}")


#If nothing is printed out. No bug was found
