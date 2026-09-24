package {{package}};

import {{package}}.registry.ModBlocks;
import {{package}}.registry.ModItems;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;

@Mod({{main_class}}.MOD_ID)
public class {{main_class}} {
    public static final String MOD_ID = "{{mod_id}}";

    public {{main_class}}(IEventBus modEventBus) {
        ModBlocks.BLOCKS.register(modEventBus);
        ModItems.ITEMS.register(modEventBus);
        modEventBus.addListener(ModItems::addCreative);
    }
}
